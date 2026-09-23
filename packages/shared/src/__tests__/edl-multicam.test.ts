import { describe, it, expect } from "vitest"
import { remapMsThroughEdl, type Edl, type EdlRegion, type EdlSegment } from "../edl.js"
import {
  EDL_FULL_FRAME,
  mergeEdlSourceOffsets,
  resolveEdlSegmentSlots,
  type ResolveEdlSlotsOptions,
} from "../edl-multicam.js"

// Distinct, valid boxes so a test can tell which rung supplied the region.
const R_SLOT: EdlRegion = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
const R_SEGMENT: EdlRegion = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }
const R_RESOLVER: EdlRegion = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }
const R_SPEAKER: EdlRegion = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }
const R_SOURCE: EdlRegion = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
/** Past the right edge (x+w > 1) — not a valid in-frame box. */
const R_INVALID: EdlRegion = { x: 0.6, y: 0, w: 0.6, h: 0.5 }

// ─────────────────────────────────────────────────────────────────────────
//  resolveEdlSegmentSlots — D20
// ─────────────────────────────────────────────────────────────────────────

describe("resolveEdlSegmentSlots — D20 precedence", () => {
  /** Every rung present; `drop` removes the named rungs (top-down mutation). */
  function ladder(drop: ReadonlySet<string>) {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "wide", url: "u", kind: "video", role: "master-audio", ...(drop.has("source") ? {} : { region: R_SOURCE }) }],
      segments: [],
    }
    const segment: EdlSegment = {
      id: "s0",
      inMs: 0,
      outMs: 1000,
      video: "wide",
      speaker: "A",
      ...(drop.has("segment") ? {} : { region: R_SEGMENT }),
      layout: { mode: "single", slots: [{ source: "wide", ...(drop.has("slot") ? {} : { region: R_SLOT }) }] },
    }
    const opts: ResolveEdlSlotsOptions = {
      regionFor: () => (drop.has("resolver") ? undefined : R_RESOLVER),
      speakerRegions: drop.has("speaker") ? [] : [{ source: "wide", speaker: "A", region: R_SPEAKER }],
    }
    const slots = resolveEdlSegmentSlots(edl, segment, opts)
    expect(slots).toHaveLength(1)
    return slots[0]
  }

  // Each row: with every rung ABOVE it removed (and every rung below still
  // present), that rung wins. Row k+1 is row k's mutation — remove the winning
  // rung and the next one wins.
  const order = [
    ["slot", R_SLOT],
    ["segment", R_SEGMENT],
    ["resolver", R_RESOLVER],
    ["speaker", R_SPEAKER],
    ["source", R_SOURCE],
    ["full", EDL_FULL_FRAME],
  ] as const
  order.forEach(([rung, region], k) => {
    it(`"${rung}" wins over every lower rung; removing it hands over to "${order[k + 1]?.[0] ?? "(none)"}"`, () => {
      const higher = new Set<string>(order.slice(0, k).map(([r]) => r))
      const slot = ladder(higher)
      expect(slot.regionFrom).toBe(rung)
      expect(slot.region).toEqual(region)
      if (k + 1 < order.length) {
        const next = ladder(new Set([...higher, rung]))
        expect(next.regionFrom).toBe(order[k + 1][0])
      }
    })
  })

  it("the full frame is the frozen EDL_FULL_FRAME", () => {
    expect(EDL_FULL_FRAME).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(Object.isFrozen(EDL_FULL_FRAME)).toBe(true)
  })
})

describe("resolveEdlSegmentSlots — slots, speakers, keying", () => {
  const edl: Edl = {
    version: 1,
    clock: "master",
    sources: [
      { id: "wide", url: "u", kind: "video", region: R_SOURCE },
      { id: "camA", url: "u", kind: "video" },
      { id: "camB", url: "u", kind: "video" },
      { id: "mic", url: "u", kind: "audio", role: "master-audio" },
    ],
    segments: [],
  }

  it("a non-array speakerRegions is ignored, never thrown on", () => {
    const opts = { speakerRegions: { wide: R_SPEAKER } } as unknown as ResolveEdlSlotsOptions
    expect(() => resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, video: "wide", speaker: "A" }, opts)).not.toThrow()
  })

  it("keys the speaker table by (source, speaker): a region for (wide, A) is NOT applied to (camA, A)", () => {
    const opts: ResolveEdlSlotsOptions = { speakerRegions: [{ source: "wide", speaker: "A", region: R_SPEAKER }] }
    const onCam = resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, video: "camA", speaker: "A" }, opts)
    expect(onCam).toEqual([{ source: "camA", region: EDL_FULL_FRAME, regionFrom: "full", speaker: "A" }])
    const onWide = resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, video: "wide", speaker: "A" }, opts)
    expect(onWide[0]).toMatchObject({ source: "wide", region: R_SPEAKER, regionFrom: "speaker", speaker: "A" })
  })

  it("ignores segment.region on a 2-slot layout (it is single-slot only)", () => {
    const seg: EdlSegment = {
      id: "s",
      inMs: 0,
      outMs: 1,
      video: "camA",
      region: R_SEGMENT,
      layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "wide" }] },
    }
    const slots = resolveEdlSegmentSlots(edl, seg)
    expect(slots.map((s) => [s.source, s.regionFrom])).toEqual([
      ["camA", "full"],
      ["wide", "source"],
    ])
  })

  it("a multi-slot slot's speaker is its own (never the segment's), and weight passes through", () => {
    const seg: EdlSegment = {
      id: "s",
      inMs: 0,
      outMs: 1,
      speaker: "A",
      layout: { mode: "side-by-side", slots: [{ source: "camA", speaker: "A", weight: 1 }, { source: "camB", weight: 0.4 }] },
    }
    expect(resolveEdlSegmentSlots(edl, seg)).toEqual([
      { source: "camA", region: EDL_FULL_FRAME, regionFrom: "full", speaker: "A", weight: 1 },
      { source: "camB", region: EDL_FULL_FRAME, regionFrom: "full", weight: 0.4 },
    ])
  })

  it("with no layout slots, makes ONE implicit slot from segment.video (speaker = segment.speaker)", () => {
    const slots = resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, video: "wide", speaker: "B", layout: { mode: "single", slots: [] } })
    expect(slots).toEqual([{ source: "wide", region: R_SOURCE, regionFrom: "source", speaker: "B" }])
  })

  it("no video and no slots → []", () => {
    expect(resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, audio: "mic" })).toEqual([])
  })

  it("an invalid region on any rung falls through to the next rung", () => {
    const seg: EdlSegment = { id: "s", inMs: 0, outMs: 1, video: "wide", speaker: "A", region: R_INVALID, layout: { mode: "single", slots: [{ source: "wide", region: { x: Number.NaN, y: 0, w: 0.5, h: 0.5 } }] } }
    const opts: ResolveEdlSlotsOptions = {
      regionFor: () => ({ x: 0, y: 0, w: 0, h: 0.5 }), // zero width
      speakerRegions: [{ source: "wide", speaker: "A", region: { x: 0, y: 0.8, w: 0.5, h: 0.5 } }], // past the bottom
    }
    expect(resolveEdlSegmentSlots(edl, seg, opts)[0]).toMatchObject({ region: R_SOURCE, regionFrom: "source" })
  })

  it("an unknown source id skips the source rung (full frame)", () => {
    const slots = resolveEdlSegmentSlots(edl, { id: "s", inMs: 0, outMs: 1, video: "ghost" })
    expect(slots).toEqual([{ source: "ghost", region: EDL_FULL_FRAME, regionFrom: "full" }])
  })

  it("regionFor receives (segment, source, speaker) per slot", () => {
    const calls: Array<{ segment: EdlSegment; source: string; speaker?: string }> = []
    const seg: EdlSegment = {
      id: "s",
      inMs: 0,
      outMs: 1,
      layout: { mode: "side-by-side", slots: [{ source: "camA", speaker: "A" }, { source: "camB" }] },
    }
    resolveEdlSegmentSlots(edl, seg, { regionFor: (q) => { calls.push(q); return undefined } })
    expect(calls).toHaveLength(2)
    expect(calls[0].segment).toBe(seg)
    expect(calls[0]).toMatchObject({ source: "camA", speaker: "A" })
    expect(calls[1]).toMatchObject({ source: "camB" })
    expect(calls[1].speaker).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  mergeEdlSourceOffsets — D19, anchored SET
// ─────────────────────────────────────────────────────────────────────────

/** Two cameras + a master mic. Segments are on the mic's (master) clock. */
function podcast(): Edl {
  return {
    version: 1,
    clock: "master",
    sources: [
      { id: "camA", url: "https://x/a.mp4", kind: "video" },
      { id: "camB", url: "https://x/b.mp4", kind: "video" },
      { id: "mic", url: "https://x/m.wav", kind: "audio", role: "master-audio" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "camA" },
      // 5000–8000 dropped
      { id: "s1", inMs: 8000, outMs: 20000, video: "camB" },
    ],
  }
}

describe("mergeEdlSourceOffsets — anchored rebase", () => {
  it("rebases onto the master when audio-sync's reference is NOT the master (the −1200 ms mic example)", () => {
    // audio-sync measured against its reference camA (refMs = sourceMs + offset):
    // the mic reads −1200. A plain SET would write mic.offsetMs = −1200 and read
    // every segment 1.2 s late; anchored, the mic stays at 0 and the cameras move.
    const r = mergeEdlSourceOffsets(podcast(), { camA: 0, camB: 500, mic: -1200 })
    expect(r.anchor).toBe("mic")
    const off = Object.fromEntries(r.edl.sources.map((s) => [s.id, s.offsetMs]))
    expect(off).toEqual({ camA: 1200, camB: 1700, mic: undefined })
    expect(r.applied).toEqual(["camA", "camB"])
    expect(r.ignored).toEqual([])
  })

  it("never changes the anchor's own offsetMs and rebases the others onto it", () => {
    const edl: Edl = { ...podcast(), sources: podcast().sources.map((s) => (s.id === "mic" ? { ...s, offsetMs: 300 } : s)) }
    const r = mergeEdlSourceOffsets(edl, { camA: 0, camB: 500, mic: -1200 })
    const off = Object.fromEntries(r.edl.sources.map((s) => [s.id, s.offsetMs]))
    expect(off).toEqual({ camA: 1500, camB: 2000, mic: 300 })
  })

  it("opts.anchor overrides the master-audio default", () => {
    const r = mergeEdlSourceOffsets(podcast(), { camA: 0, camB: 500, mic: -1200 }, { anchor: "camA" })
    expect(r.anchor).toBe("camA")
    const off = Object.fromEntries(r.edl.sources.map((s) => [s.id, s.offsetMs]))
    expect(off).toEqual({ camA: undefined, camB: 500, mic: -1200 })
  })

  it("is SET, never ADD: re-running on its own output is idempotent", () => {
    const offsets = { camA: 0, camB: 500, mic: -1200 }
    const once = mergeEdlSourceOffsets(podcast(), offsets).edl
    const twice = mergeEdlSourceOffsets(once, offsets).edl
    expect(twice).toEqual(once)
  })

  it("rounds to integer ms", () => {
    const r = mergeEdlSourceOffsets(podcast(), { camA: 0.4, camB: 500.6, mic: -0.2 })
    const off = Object.fromEntries(r.edl.sources.map((s) => [s.id, s.offsetMs]))
    // camA: 0.4 + 0.2 = 0.6 → 1 ; camB: 500.6 + 0.2 = 500.8 → 501
    expect(off).toEqual({ camA: 1, camB: 501, mic: undefined })
  })

  it("reports an unknown source and a non-finite offset in ignored, applying the rest", () => {
    const r = mergeEdlSourceOffsets(podcast(), { camA: 100, ghost: 5, camB: Number.NaN, mic: 0 })
    expect(r.applied).toEqual(["camA"])
    expect(r.ignored).toEqual([
      { sourceId: "ghost", reason: "unknown-source" },
      { sourceId: "camB", reason: "not-finite" },
    ])
    expect(r.edl.sources.find((s) => s.id === "camB")?.offsetMs).toBeUndefined()
    expect(r.edl.sources.find((s) => s.id === "camA")?.offsetMs).toBe(100)
  })

  it("anchor-unknown applies NOTHING", () => {
    const input = podcast()
    const r = mergeEdlSourceOffsets(input, { camA: 100, camB: 200 }, { anchor: "ghost" })
    expect(r.applied).toEqual([])
    expect(r.ignored).toEqual([{ sourceId: "ghost", reason: "anchor-unknown" }])
    expect(r.edl).toEqual(input)
    expect(r.anchor).toBeUndefined()
  })

  it("anchor-not-finite applies NOTHING", () => {
    const input = podcast()
    const r = mergeEdlSourceOffsets(input, { camA: 100, camB: 200, mic: Number.POSITIVE_INFINITY })
    expect(r.applied).toEqual([])
    expect(r.ignored).toEqual([{ sourceId: "mic", reason: "anchor-not-finite" }])
    expect(r.edl).toEqual(input)
  })

  it("with no anchor (no unique master-audio) sets the offsets verbatim (rounded)", () => {
    const noMaster: Edl = { ...podcast(), sources: podcast().sources.map((s) => ({ ...s, role: undefined })) }
    const r = mergeEdlSourceOffsets(noMaster, { camA: 0, camB: 500.4, mic: -1200 })
    expect(r.anchor).toBeUndefined()
    const off = Object.fromEntries(r.edl.sources.map((s) => [s.id, s.offsetMs]))
    expect(off).toEqual({ camA: 0, camB: 500, mic: -1200 })
    // Two master-audio sources are not a UNIQUE master either.
    const twoMasters: Edl = { ...podcast(), sources: podcast().sources.map((s) => ({ ...s, role: "master-audio" })) }
    expect(mergeEdlSourceOffsets(twoMasters, { camB: 7 }).anchor).toBeUndefined()
  })

  it("returns a new Edl and never mutates its input", () => {
    const input = podcast()
    const snapshot = JSON.parse(JSON.stringify(input))
    const offsets = { camA: 0, camB: 500, mic: -1200 }
    const r = mergeEdlSourceOffsets(input, offsets)
    expect(r.edl).not.toBe(input)
    expect(input).toEqual(snapshot)
    expect(offsets).toEqual({ camA: 0, camB: 500, mic: -1200 })
  })

  it("remapMsThroughEdl round-trip: an instant on camera B's clock lands at the expected output time after the merge", () => {
    // Event E at reference (camA) time 9500. refMs = sourceMs + offset ⇒ camB
    // reads it at 9000, the mic (master) at 10700. On the master clock E is in
    // s1 [8000, 20000), which starts at output 5000 (s0 is 5000 long) ⇒ 7700.
    const { edl } = mergeEdlSourceOffsets(podcast(), { camA: 0, camB: 500, mic: -1200 })
    expect(remapMsThroughEdl(edl, 9000, "camB")).toBe(7700)
    // …and the same instant read on the master clock agrees.
    expect(remapMsThroughEdl(edl, 10700, "mic")).toBe(7700)
    expect(remapMsThroughEdl(edl, 9500, "camA")).toBe(7700)
  })

  it("never throws on garbage input", () => {
    expect(() => mergeEdlSourceOffsets({} as Edl, { a: 1 })).not.toThrow()
    expect(mergeEdlSourceOffsets({} as Edl, { a: 1 }).ignored).toEqual([{ sourceId: "a", reason: "unknown-source" }])
    expect(() => mergeEdlSourceOffsets(podcast(), null as unknown as Record<string, number>)).not.toThrow()
  })
})
