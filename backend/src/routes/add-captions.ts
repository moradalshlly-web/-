import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import {
  ALL_CAPTION_STYLES,
  isKineticCaptionStyle,
  captionRoutesToRemotion,
  SUPPORTED_FONT_NAMES,
  CAPTION_LOOK_IDS,
  KINETIC_ONLY_CAPTION_LEVER_KEYS,
  normalizeTranscript,
  TRANSCRIBE_LANES,
  TRANSCRIBE_PROVIDER_CAPABILITIES,
  transcribeProvidersWithWordTimestamps,
} from "@nodaro/shared"
import { captionFontWeightSchema } from "../lib/plan-schemas.js"
import { findSegmentOverlap } from "../providers/video/caption-segments.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

/** Parse a stringified Transcript before normalization so this ingress behaves
 *  identically to the DAG payload-builder (which parses the stringified json
 *  handle value). A non-string passes through; unparseable → undefined → an
 *  empty (zero-word) transcript → 400. */
function safeParseJsonForTranscript(v: string): unknown {
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

// A text caption source must carry a visible glyph — whitespace-only text
// synthesises to zero words (splitWithLeadingSpace drops it) and would leave the
// render with no captions, failing plan validation AFTER credits reserve. Reject
// it as a clean 400 instead.
const nonBlankText = z.string().min(1).refine((t) => /\S/.test(t), { message: "text must contain a non-whitespace character" })

const captionInputSchema = z.object({
  text: z.string(),
  // Word-timed entry (one per word for the kinetic styles). startMs/endMs are
  // the visibility window and drive the highlight; timestampMs is the word
  // timestamp used by tiktok-words token timing; confidence is metadata,
  // ignored by rendering. timestampMs/confidence are optional (default null).
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().min(0).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
})

// One caption SEGMENT: a time range with optional style/look overrides (each
// inherits the top-level value when omitted) and optional own words (`text` or
// `captions[]`; falls back to the shared transcript filtered to the range).
// A segmented render is entirely Remotion, so any `style` (incl. subtitle) and
// any look lever is valid on a segment.
const captionSegmentInputSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  style: z.enum(ALL_CAPTION_STYLES).optional(),
  position: z.enum(["bottom", "top", "center"]).optional(),
  fontSize: z.number().min(12).max(200).optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  // A named look preset (outline/clean); explicit levers below override it.
  look: z.enum(CAPTION_LOOK_IDS).optional(),
  fontFamily: z.enum(SUPPORTED_FONT_NAMES).optional(),
  fontWeight: captionFontWeightSchema.optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  highlightColor: z.string().optional(),
  uppercase: z.boolean().optional(),
  positionY: z.number().min(0).max(100).optional(),
  animate: z.boolean().optional(),
  text: nonBlankText.optional(),
  captions: z.array(captionInputSchema).optional(),
}).refine((s) => s.endMs > s.startMs, { message: "segment endMs must be greater than startMs" })

function buildAddCaptionsCreditId(body: unknown): string {
  if (!body || typeof body !== "object") return "add-captions"
  const b = body as Record<string, unknown>
  // Price follows the RENDERER: anything that routes to Remotion (segments, a
  // kinetic style, or a styled/timed/transcribed subtitle) bills as :kinetic; a
  // plain-text subtitle on the cheap FFmpeg drawtext path bills as add-captions.
  // Same predicate the worker dispatches on (captionRoutesToRemotion) so the
  // price and the renderer can never drift.
  return captionRoutesToRemotion({
    style: typeof b.style === "string" ? b.style : undefined,
    text: typeof b.text === "string" ? b.text : undefined,
    segments: Array.isArray(b.segments) ? b.segments : undefined,
    transcript: b.transcript,
    captions: Array.isArray(b.captions) ? b.captions : undefined,
    look: b.look,
    fontFamily: b.fontFamily,
    fontWeight: b.fontWeight,
    strokeColor: b.strokeColor,
    strokeWidth: b.strokeWidth,
    uppercase: b.uppercase,
    positionY: b.positionY,
  })
    ? "add-captions:kinetic"
    : "add-captions"
}

// Optional "look" levers. They shape ONLY the Remotion-rendered kinetic styles;
// the static `subtitle` path is FFmpeg drawtext and cannot honour them, so the
// refine below REJECTS them on a non-kinetic style rather than silently
// dropping them (a silent no-op is the failure this guards against).
export const addCaptionsBody = z.object({
  videoUrl: safeUrlSchema,
  text: nonBlankText.optional(),
  captions: z.array(captionInputSchema).optional(),
  // A wired upstream Transcript (from `transcribe` or `apply-edl`'s json
  // handle) used as the caption source. Object or JSON string — normalized +
  // word-checked at ingress below. The mapper (captions-mappers.ts) reshapes
  // its words into the caption list the kinetic burn-in expects.
  transcript: z.unknown().optional(),
  // Word-level (one caption per word — karaoke/word-highlight) vs grouped lines.
  // Only meaningful with a wired `transcript`; defaults to word-level.
  wordLevel: z.boolean().optional(),
  auto_transcribe: z.boolean().optional(),
  transcribe_provider: z.enum(TRANSCRIBE_LANES).optional(),
  style: z.enum(ALL_CAPTION_STYLES).optional().default("subtitle"),
  position: z.enum(["bottom", "top", "center"]).optional().default("bottom"),
  fontSize: z.number().min(12).max(200).optional().default(32),
  color: z.string().optional().default("white"),
  backgroundColor: z.string().optional(),
  // Kinetic-style look levers (kinetic styles only — see KINETIC_ONLY_CAPTION_LEVER_KEYS).
  // `look` selects a named preset (outline/clean); the explicit levers below
  // override individual fields of it. An unset `look` resolves to the default
  // preset in the worker (resolveCaptionLook), so it is NOT defaulted here.
  look: z.enum(CAPTION_LOOK_IDS).optional(),
  fontFamily: z.enum(SUPPORTED_FONT_NAMES).optional(),
  fontWeight: captionFontWeightSchema.optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  highlightColor: z.string().optional(),
  uppercase: z.boolean().optional(),
  positionY: z.number().min(0).max(100).optional(),
  // Per-word motion switch for the kinetic styles (default true); rejected on
  // `subtitle` (nothing to animate) by the KINETIC_ONLY guard below.
  animate: z.boolean().optional(),
  // Optional per-segment captions: apply DIFFERENT treatments to time ranges of
  // the same video in one call (e.g. a large top intro, then a bottom body).
  segments: z.array(captionSegmentInputSchema).min(1).optional(),
  userId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  const hasSegments = !!(v.segments && v.segments.length > 0)
  const hasTranscript = v.transcript !== undefined && v.transcript !== null
  // Need at least one caption source. auto_transcribe defaults to undefined,
  // which the worker treats as true — so absent flag = transcribe attempted.
  // With segments, a segment that carries its OWN text/captions is self-sourced.
  const hasTopLevelSource = !!(v.text || (v.captions && v.captions.length > 0) || hasTranscript || v.auto_transcribe !== false)
  const everySegmentSelfSourced = hasSegments && v.segments!.every((s) => s.text || (s.captions && s.captions.length > 0))
  if (!hasTopLevelSource && !everySegmentSelfSourced) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text, captions, auto_transcribe, or give each segment its own text/captions",
    })
  }
  // The auto-transcribe lane feeds WORD timings to the kinetic/segmented
  // render, so a transcription provider that cannot produce them has nothing to
  // give it. The worker SKIPS the vendor call for such a lane (it would only
  // earn `transcribe()`'s refusal) and falls through to its text / no-source
  // ladder — so the request is only impossible when transcription is the ONLY
  // caption source this render could have. Reject exactly that case at ingress;
  // anything the worker can still render must pass.
  // Four conditions, all required:
  //   1. the render actually needs word timings — a kinetic style, or segments
  //      (a segmented render is entirely Remotion and word-timed);
  //   2. transcription actually runs — MIRRORS the worker's own `needTranscribe`
  //      (workers/handlers/ffmpeg.ts): captions[] or a wired transcript replace
  //      it, `auto_transcribe: false` disables it, and with segments it only
  //      runs when some segment needs the shared transcript. NOTE `text` does
  //      NOT disable transcription in the worker — it is the FALLBACK source
  //      (condition 3), used whenever the transcription produced no words or
  //      was skipped. The two predicates live in different files and must be
  //      changed together;
  //   3. there is no `text` to fall back to. With `text`, a skipped/word-less
  //      transcription still renders — as evenly-spaced synthetic captions off
  //      that text, which is what this node did before word timings existed.
  //      Rejecting it would break a previously-working call;
  //   4. the caller explicitly named a provider that can't do word timings.
  //      An absent provider is fine: the worker defaults to a capable lane.
  if (v.transcribe_provider && !TRANSCRIBE_PROVIDER_CAPABILITIES[v.transcribe_provider].wordTimestamps) {
    const needsWordTimings = hasSegments || isKineticCaptionStyle(v.style)
    const someSegmentNeedsShared =
      hasSegments && v.segments!.some((s) => !(s.text || (s.captions && s.captions.length > 0)))
    const willTranscribe =
      !(v.captions && v.captions.length > 0) &&
      !hasTranscript &&
      v.auto_transcribe !== false &&
      (!hasSegments || someSegmentNeedsShared)
    if (needsWordTimings && willTranscribe && !v.text) {
      ctx.addIssue({
        code: "custom",
        path: ["transcribe_provider"],
        message:
          `"${v.transcribe_provider}" does not return word timestamps, and this render has no other ` +
          `caption source — use ${transcribeProvidersWithWordTimestamps().join(" or ")}, or supply ` +
          `text/captions/transcript instead`,
      })
    }
  }
  // Segments must be non-overlapping (each renders its own overlay; overlapping
  // ranges would draw two captions at once).
  if (hasSegments) {
    const overlap = findSegmentOverlap(v.segments!)
    if (overlap) ctx.addIssue({ code: "custom", path: ["segments"], message: overlap })
  }
  // `highlightColor` and `animate` are meaningless on `subtitle` (no spoken-word
  // cursor to colour, no motion to switch off), so reject them on it. The STYLING
  // levers are NO LONGER rejected — a subtitle carrying one routes to the Remotion
  // SubtitleOverlay (captionRoutesToRemotion), which applies it. The key list is
  // shared (KINETIC_ONLY_CAPTION_LEVER_KEYS) so it stays in step with the frontend
  // strip; iterating `v[k]` also makes tsc fail if a key isn't a field of this
  // body (totality guard). A wired transcript on `subtitle` is now VALID (it
  // routes to Remotion and renders as timed phrase lines) — no rejection.
  if (!hasSegments && !isKineticCaptionStyle(v.style)) {
    for (const k of KINETIC_ONLY_CAPTION_LEVER_KEYS) {
      if (v[k] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [k],
          message: `${k} only applies to the kinetic caption styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy); the "${v.style}" style ignores it`,
        })
      }
    }
  }
})

export async function addCaptionsRoutes(app: FastifyInstance) {
  app.post("/v1/add-captions", { preHandler: creditGuard((req) => buildAddCaptionsCreditId(req.body)) }, async (req, reply) => {
    const parsed = addCaptionsBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Validate the wired transcript at ingress (apply-edl's rule) so we never
    // reserve credits for a render that would die producing an empty caption
    // plan. Two distinct failures: a non-JSON input (someone wired a text/media
    // pip into the json handle) vs a genuinely empty transcript.
    if (parsed.data.transcript !== undefined && parsed.data.transcript !== null) {
      const t = parsed.data.transcript
      const raw = typeof t === "string" ? safeParseJsonForTranscript(t) : t
      if (typeof t === "string" && raw === undefined) {
        return reply.status(400).send({
          error: { code: "invalid_transcript", message: "transcript input is not JSON — wire the Transcript (json) output" },
        })
      }
      if (normalizeTranscript(raw).words.length === 0) {
        return reply.status(400).send({
          error: { code: "invalid_transcript", message: "transcript has no words to caption" },
        })
      }
    }

    const modelIdentifier = buildAddCaptionsCreditId(parsed.data)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "add-captions"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("add-captions", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
