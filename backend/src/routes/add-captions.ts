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
import { ALL_CAPTION_STYLES, isKineticCaptionStyle, SUPPORTED_FONT_NAMES } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

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

function buildAddCaptionsCreditId(body: unknown): string {
  if (!body || typeof body !== "object") return "add-captions"
  const style = (body as Record<string, unknown>).style
  if (typeof style === "string" && isKineticCaptionStyle(style)) return "add-captions:kinetic"
  return "add-captions"
}

// Optional "look" levers. They shape ONLY the Remotion-rendered kinetic styles;
// the static `subtitle` path is FFmpeg drawtext and cannot honour them, so the
// refine below REJECTS them on a non-kinetic style rather than silently
// dropping them (a silent no-op is the failure this guards against).
export const addCaptionsBody = z.object({
  videoUrl: safeUrlSchema,
  text: z.string().min(1).optional(),
  captions: z.array(captionInputSchema).optional(),
  auto_transcribe: z.boolean().optional(),
  transcribe_provider: z.enum(["whisper", "incredibly-fast-whisper", "elevenlabs-stt"]).optional(),
  style: z.enum(ALL_CAPTION_STYLES).optional().default("subtitle"),
  position: z.enum(["bottom", "top", "center"]).optional().default("bottom"),
  fontSize: z.number().min(12).max(200).optional().default(32),
  color: z.string().optional().default("white"),
  backgroundColor: z.string().optional(),
  // Kinetic-style look levers (kinetic styles only — see LOOK_LEVER_KEYS).
  fontFamily: z.enum(SUPPORTED_FONT_NAMES).optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  highlightColor: z.string().optional(),
  uppercase: z.boolean().optional(),
  positionY: z.number().min(0).max(100).optional(),
  userId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  // Need at least one caption source. auto_transcribe defaults to undefined,
  // which the worker treats as true — so absent flag = transcribe attempted.
  const hasSource = v.text || (v.captions && v.captions.length > 0) || v.auto_transcribe !== false
  if (!hasSource) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text, captions, or set auto_transcribe (default true for kinetic styles)",
    })
  }
  // Look levers only apply to the Remotion kinetic path. `style` is already
  // defaulted to "subtitle" here, so an unset style rejects a stray look lever.
  if (!isKineticCaptionStyle(v.style)) {
    const looks: Array<[string, unknown]> = [
      ["fontFamily", v.fontFamily],
      ["strokeColor", v.strokeColor],
      ["strokeWidth", v.strokeWidth],
      ["highlightColor", v.highlightColor],
      ["uppercase", v.uppercase],
      ["positionY", v.positionY],
    ]
    for (const [k, val] of looks) {
      if (val !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [k],
          message: `${k} only applies to kinetic caption styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy); the "${v.style}" style ignores it`,
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
