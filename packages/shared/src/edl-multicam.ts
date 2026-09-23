/**
 * Multicam helpers over the EDL contract (`edl.ts`): folding measured source
 * offsets into an EDL (D19) and resolving what each on-screen slot of a
 * segment shows (D20). Pure — no I/O. Type-only imports from `edl.ts` keep the
 * module graph free of runtime cycles.
 */
import type { Edl, EdlRegion, EdlSegment, EdlSource } from "./edl.js"

// ─────────────────────────────────────────────────────────────────────────
//  D19 — source offsets
// ─────────────────────────────────────────────────────────────────────────

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** audio-sync → EDL source offsets (D19: masterMs = sourceMs + offsetMs).
 *  `offsets` are measured against ONE common reference (audio-sync's `reference`, which need not be the master).
 *  ANCHORED SET: anchor = opts.anchor ?? the unique role:"master-audio" source ?? none.
 *   - The anchor's own offsetMs is NEVER changed (the segments are on its clock).
 *   - Every other provided source s: offsetMs = round((anchor.offsetMs ?? 0) + offsets[s] − (offsets[anchor] ?? 0)).
 *   - No anchor: offsetMs = round(offsets[s]) verbatim (offsets already relative to the master clock).
 *  SET, never ADD (re-running is idempotent). Returns a new Edl; never mutates; never throws.
 *  `ignored[].reason` is a documented open string: "unknown-source" | "not-finite" | "anchor-unknown" | "anchor-not-finite".
 *  opts.anchor not in edl.sources → NOTHING applied, ignored = [{ sourceId: anchor, reason: "anchor-unknown" }].
 *  offsets[anchor] present but non-finite → NOTHING applied, ignored = [{ sourceId: anchor, reason: "anchor-not-finite" }]. */
export function mergeEdlSourceOffsets(
  edl: Edl,
  offsets: Readonly<Record<string, number>>,
  opts?: { readonly anchor?: string },
): {
  readonly edl: Edl
  /** The source the offsets were anchored to — present whenever one resolved (it exists in `edl.sources`). */
  readonly anchor?: string
  /** Source ids whose `offsetMs` was set, in `offsets` key order. */
  readonly applied: readonly string[]
  readonly ignored: ReadonlyArray<{ readonly sourceId: string; readonly reason: string }>
} {
  const sources: readonly EdlSource[] = Array.isArray(edl?.sources) ? edl.sources : []
  const rows: Readonly<Record<string, unknown>> = offsets && typeof offsets === "object" ? offsets : {}
  const byId = new Map<string, EdlSource>()
  for (const s of sources) if (s && typeof s === "object" && !byId.has(s.id)) byId.set(s.id, s)

  let anchor: string | undefined
  if (opts?.anchor !== undefined) {
    if (!byId.has(opts.anchor)) {
      return { edl: { ...edl }, applied: [], ignored: [{ sourceId: opts.anchor, reason: "anchor-unknown" }] }
    }
    anchor = opts.anchor
  } else {
    const masters = sources.filter((s) => s && typeof s === "object" && s.role === "master-audio")
    if (masters.length === 1) anchor = masters[0].id
  }

  // The anchor's own measurement is the rebase point; an absent one reads as 0.
  let reference = 0
  if (anchor !== undefined && hasOwn(rows, anchor)) {
    const a = rows[anchor]
    if (!isFiniteNumber(a)) {
      return { edl: { ...edl }, anchor, applied: [], ignored: [{ sourceId: anchor, reason: "anchor-not-finite" }] }
    }
    reference = a
  }
  const anchorOffsetMs = anchor !== undefined ? (byId.get(anchor)?.offsetMs ?? 0) : 0

  const next = new Map<string, number>()
  const applied: string[] = []
  const ignored: Array<{ sourceId: string; reason: string }> = []
  for (const sourceId of Object.keys(rows)) {
    if (sourceId === anchor) continue // never changed: the segments are on its clock
    if (!byId.has(sourceId)) {
      ignored.push({ sourceId, reason: "unknown-source" })
      continue
    }
    const measured = rows[sourceId]
    const offsetMs = isFiniteNumber(measured)
      ? Math.round(anchor !== undefined ? anchorOffsetMs + measured - reference : measured)
      : Number.NaN
    // A non-finite result (the measurement, or a non-finite anchor offsetMs it
    // is rebased onto) is never written.
    if (!Number.isFinite(offsetMs)) {
      ignored.push({ sourceId, reason: "not-finite" })
      continue
    }
    next.set(sourceId, offsetMs)
    applied.push(sourceId)
  }

  const merged: Edl = Array.isArray(edl?.sources)
    ? { ...edl, sources: edl.sources.map((s) => (s && typeof s === "object" && next.has(s.id) ? { ...s, offsetMs: next.get(s.id)! } : s)) }
    : { ...edl }
  return { edl: merged, ...(anchor !== undefined ? { anchor } : {}), applied, ignored }
}

// ─────────────────────────────────────────────────────────────────────────
//  D20 — slot resolution
// ─────────────────────────────────────────────────────────────────────────

export const EDL_FULL_FRAME: EdlRegion = Object.freeze({ x: 0, y: 0, w: 1, h: 1 })

export interface EdlResolvedSlot {
  readonly source: string
  readonly region: EdlRegion
  /** "resolver" = the caller's `regionFor` (v3 per-segment tracks). */
  readonly regionFrom: "slot" | "segment" | "resolver" | "speaker" | "source" | "full"
  readonly speaker?: string
  readonly weight?: number
}

export interface ResolveEdlSlotsOptions {
  /** speaker-view's per-speaker framing table (a node SETTING, not an EDL field), keyed by (source, speaker) so a
   *  wide-shot region never lands on a close-up camera framing the same person. */
  readonly speakerRegions?: ReadonlyArray<{ readonly source: string; readonly speaker: string; readonly region: EdlRegion }>
  /** v3 hook: a per-(segment, slot) region, e.g. from a face track. Undefined = no opinion. */
  readonly regionFor?: (q: { readonly segment: EdlSegment; readonly source: string; readonly speaker?: string }) => EdlRegion | undefined
}

/** A valid in-frame box: finite, 0..1, w/h > 0, x+w ≤ 1, y+h ≤ 1 — with the
 *  same edge tolerance `validateEdl` accepts, so the two never disagree. */
function isInFrameRegion(r: unknown): r is EdlRegion {
  if (!r || typeof r !== "object") return false
  const { x, y, w, h } = r as Record<string, unknown>
  for (const v of [x, y, w, h]) if (!isFiniteNumber(v) || v < 0 || v > 1) return false
  const box = r as EdlRegion
  return box.w > 0 && box.h > 0 && box.x + box.w <= 1 + 1e-9 && box.y + box.h <= 1 + 1e-9
}

type Rung = EdlResolvedSlot["regionFrom"]

/** D20 — the ONE region-precedence implementation:
 *  slot.region ▷ segment.region (single-slot only) ▷ regionFor ▷ speakerRegions[(source, speaker)] ▷ source.region ▷ full frame.
 *  Slots = layout.slots when non-empty, else ONE implicit slot from segment.video (no video → []).
 *  A slot's speaker = slot.speaker ?? (single slot ? segment.speaker : undefined); no speaker → the speaker rung is skipped.
 *  A rung whose region is not a valid in-frame box (finite, 0..1, w/h > 0, x+w ≤ 1, y+h ≤ 1) falls through to the next.
 *  Unknown source id → the source rung is skipped. Pure; never throws on its own. */
export function resolveEdlSegmentSlots(edl: Edl, segment: EdlSegment, opts?: ResolveEdlSlotsOptions): readonly EdlResolvedSlot[] {
  if (!segment || typeof segment !== "object") return []
  const sources: readonly EdlSource[] = Array.isArray(edl?.sources) ? edl.sources : []
  const layoutSlots = Array.isArray(segment.layout?.slots) ? segment.layout!.slots! : []
  const slots: NonNullable<NonNullable<EdlSegment["layout"]>["slots"]> =
    layoutSlots.length > 0
      ? layoutSlots
      : typeof segment.video === "string" && segment.video
        ? [{ source: segment.video }]
        : []
  const single = slots.length === 1

  const out: EdlResolvedSlot[] = []
  for (const slot of slots) {
    if (!slot || typeof slot !== "object") continue
    const source = slot.source
    const speaker = slot.speaker ?? (single ? segment.speaker : undefined)

    // Each rung is evaluated lazily, top-down; the first valid box wins.
    const rungs: ReadonlyArray<readonly [Rung, () => unknown]> = [
      ["slot", () => slot.region],
      ["segment", () => (single ? segment.region : undefined)],
      ["resolver", () => opts?.regionFor?.({ segment, source, ...(speaker !== undefined ? { speaker } : {}) })],
      ["speaker", () =>
        speaker === undefined
          ? undefined
          : Array.isArray(opts?.speakerRegions)
            ? opts.speakerRegions.find((row) => row && row.source === source && row.speaker === speaker)?.region
            : undefined],
      ["source", () => sources.find((s) => s && typeof s === "object" && s.id === source)?.region],
    ]
    let region: EdlRegion = EDL_FULL_FRAME
    let regionFrom: Rung = "full"
    for (const [from, read] of rungs) {
      const candidate = read()
      if (isInFrameRegion(candidate)) {
        region = candidate
        regionFrom = from
        break
      }
    }
    out.push({
      source,
      region,
      regionFrom,
      ...(speaker !== undefined ? { speaker } : {}),
      ...(slot.weight !== undefined ? { weight: slot.weight } : {}),
    })
  }
  return out
}
