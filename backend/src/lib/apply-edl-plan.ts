/**
 * apply-edl — the ONE effective-EDL + pricing helper shared by the route, the
 * DAG payload-builder, and the worker executor, so all three agree on the
 * SAME normalized EDL, the SAME rendered duration, and the SAME reserve.
 *
 * The pure EDL contract (`@nodaro/shared`) is structural vocabulary; this file
 * is the app-side glue that turns a wired/hand-written EDL + the node's
 * settings into the concrete plan the executor renders. It stays in `backend/`
 * (SUL) — the executor is not part of the public wire/SDK contract, so nothing
 * here is a new `@nodaro/shared` export.
 */
import {
  type Edl,
  type EdlSegment,
  normalizeEdl,
  validateEdl,
  edlDurationMs,
} from "@nodaro/shared"

/** Base credits per MINUTE of RENDERED output. Single source of truth for the
 *  per-minute rate: `STATIC_CREDIT_COSTS['apply-edl']` (ee/billing/credits.ts)
 *  and the `model_pricing` migration row both mirror this value.
 *
 *  PROVISIONAL — set by the 3-hour staging probe (re-derived from measured
 *  ffmpeg s/output-min, never scaled). Same order of magnitude as the flat
 *  ffmpeg render nodes (combine-videos = 30 flat). apply-edl is priced per
 *  output minute because a tightened episode's cut can be minutes long. */
export const APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE = 10

export interface EffectiveEdlOptions {
  /** Default crossfade (ms) applied at every segment boundary that carries NO
   *  explicit transition. Per-boundary clamped to `0.9·min(adjacent)` — the
   *  ffmpeg-xfade limit `validateEdl` enforces — so a global value can never
   *  silently over-blend a short segment. 0 (default) = hard cuts. */
  crossfadeMs?: number
  /** Optional media-URL overrides for `EdlSource[i].url`, POSITIONAL in edge
   *  order (the node's `sources` input). A present entry replaces that source's
   *  url; absent/empty keeps the EDL's own url (the primary contract). */
  sourceOverrides?: ReadonlyArray<string | undefined>
}

const clampBoundaryCrossfade = (raw: number, seg: EdlSegment, prev: EdlSegment): number => {
  const minAdj = Math.min(seg.outMs - seg.inMs, prev.outMs - prev.inMs)
  // floor(0.9·min) keeps it STRICTLY under validateEdl's `0.9·min + 1e-9` bound.
  return Math.min(Math.round(raw), Math.floor(0.9 * minAdj))
}

/**
 * Turn a raw (wired / hand-written) EDL plus the node settings into the single
 * effective EDL every stage renders, reserves, and remaps against. Pure and
 * deterministic:
 *   1. `normalizeEdl` (defaults, integer ms, region-fit, order preserved).
 *   2. positional `sourceOverrides` onto `EdlSource.url`.
 *   3. inject the default `crossfadeMs` on boundaries with no transition,
 *      per-boundary clamped so `validateEdl` can never reject what we built.
 *   4. `normalizeEdl` again so the injected fields land in canonical shape.
 * Callers then `validateEdl` the result and 400/throw on `issues`.
 */
export function buildEffectiveEdl(rawEdl: unknown, opts: EffectiveEdlOptions = {}): Edl {
  let edl = normalizeEdl(rawEdl)

  if (opts.sourceOverrides && opts.sourceOverrides.length > 0) {
    edl = {
      ...edl,
      sources: edl.sources.map((s, i) => {
        const url = opts.sourceOverrides?.[i]
        return url && url.trim() ? { ...s, url: url.trim() } : s
      }),
    }
  }

  const cf = Math.max(0, Math.round(opts.crossfadeMs ?? 0))
  if (cf > 0 && edl.segments.length > 1) {
    const segments = edl.segments.map((seg, i) => {
      if (i === 0) return seg
      // An explicit transition (either field) wins — never overwrite the EDL's
      // own editorial decision with the node default.
      if (seg.transition || seg.layout?.transition) return seg
      const bounded = clampBoundaryCrossfade(cf, seg, edl.segments[i - 1])
      if (bounded <= 0) return seg
      return { ...seg, transition: { type: "crossfade" as const, durationMs: bounded } }
    })
    edl = { ...edl, segments }
  }

  return normalizeEdl(edl)
}

/** Minutes of RENDERED output to reserve for — `ceil(edlDurationMs/60000)`,
 *  minimum 1. Runs on the EFFECTIVE EDL so the D17 overlap compression is
 *  already accounted for (a crossfade-heavy cut reserves less). */
export function applyEdlReserveMinutes(edl: Edl): number {
  return Math.max(1, Math.ceil(edlDurationMs(edl) / 60_000))
}

/** BASE credits (pre-markup) the route reserves via `creditGuard.computeCredits`.
 *  `creditGuard` applies the service markup so check and reserve see the same
 *  final number; the DAG reserves the SAME base via `applyEdlCreditOverride`. */
export function applyEdlBaseCredits(edl: Edl): number {
  return APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * applyEdlReserveMinutes(edl)
}

export interface ApplyEdlValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
}

/**
 * Full ingress validation: the structural `validateEdl` PLUS the two executor
 * pre-conditions that would otherwise fail mid-render (after credits are
 * reserved): every referenced source must have a non-empty url, and a
 * `video`-output edit must give every segment a picture source. Returns issues
 * so the route can 400 naming exactly what is wrong.
 */
export function validateEffectiveEdl(edl: Edl, output: "video" | "audio"): ApplyEdlValidation {
  const base = validateEdl(edl)
  const issues = [...base.issues]

  // Every source the segments reference must resolve to a real url (the
  // executor downloads from `EdlSource.url`). validateEdl already flags empty
  // urls; this re-states it per referenced id for a friendlier 400.
  const byId = new Map(edl.sources.map((s) => [s.id, s]))
  const referenced = new Set<string>()
  for (const seg of edl.segments) {
    if (seg.video) referenced.add(seg.video)
    if (seg.audio) referenced.add(seg.audio)
    for (const slot of seg.layout?.slots ?? []) referenced.add(slot.source)
  }
  for (const s of edl.sources) if (s.role === "master-audio") referenced.add(s.id)
  for (const id of referenced) {
    const s = byId.get(id)
    if (s && (!s.url || !s.url.trim())) issues.push(`source "${id}" has no url — resolve it or wire a \`sources\` override`)
  }

  if (output === "video") {
    edl.segments.forEach((seg, i) => {
      if (!seg.video) issues.push(`segment[${i}] "${seg.id}" has no video source (required for a video-output edit; use output:"audio" for an audio-only cut)`)
    })
  }

  return { ok: issues.length === 0, issues }
}

/**
 * DAG-side reserve override (probe-at-reserve, but the duration is KNOWN from
 * the effective EDL carried on the payload — no ffprobe needed). Mirrors
 * `lib/dubbing-pricing.ts::projectDubbingCreditOverride`: the workflow dispatch
 * bypasses the HTTP route's `computeCredits`, so it reserves the same
 * per-minute base × minutes (with markup) that a single-node Run would.
 * Returns `undefined` for any other job so the `??` chain in node-executor
 * falls through.
 */
export async function applyEdlCreditOverride(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "apply-edl") return undefined
  const edl = payload.edl as Edl | undefined
  if (!edl || !Array.isArray(edl.segments)) return undefined
  const minutes = applyEdlReserveMinutes(edl)
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  const { creditCost } = await getModelCreditBaseCost("apply-edl")
  const { effectiveMarkupPercent } = await import("../ee/billing/service-margin.js")
  const { getAppSettings } = await import("./app-settings.js")
  const markup = effectiveMarkupPercent(await getAppSettings(), "apply-edl")
  return Math.ceil(creditCost * minutes * (1 + markup / 100))
}
