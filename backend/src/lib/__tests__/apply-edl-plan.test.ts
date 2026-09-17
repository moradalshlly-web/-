/**
 * Unit tests for the apply-edl effective-EDL + pricing helper — the ONE module
 * the route, the payload-builder and the worker all depend on for the SAME
 * normalized EDL, reserve and remap. The reserve fixtures below are the exact
 * worked examples in docs/nodes/processing-video/apply-edl.md (CLAUDE.md:
 * "Worked examples in docs MUST match the test cases in code").
 */
import { describe, it, expect } from "vitest"
import { validateEdl, edlDurationMs, type Edl } from "@nodaro/shared"
import {
  buildEffectiveEdl,
  applyEdlReserveMinutes,
  applyEdlBaseCredits,
  validateEffectiveEdl,
  APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
} from "../apply-edl-plan.js"

const oneSegment = (durMs: number): Edl => ({
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://m.test/a.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: durMs, video: "A", audio: "A" }],
})

describe("apply-edl pricing (matches the docs worked examples)", () => {
  it("bills per RENDERED minute, ceil, floor 1 minute", () => {
    // docs table: 40 s → 10 · 3 min 10 s (190 s) → 40 · 12 min (720 s) → 120
    expect(applyEdlBaseCredits(oneSegment(40_000))).toBe(10)
    expect(applyEdlBaseCredits(oneSegment(190_000))).toBe(40)
    expect(applyEdlBaseCredits(oneSegment(720_000))).toBe(120)
  })

  it("reserve minutes = ceil(edlDurationMs/60000), floor 1", () => {
    expect(applyEdlReserveMinutes(oneSegment(40_000))).toBe(1)
    expect(applyEdlReserveMinutes(oneSegment(190_000))).toBe(4)
    expect(applyEdlReserveMinutes(oneSegment(720_000))).toBe(12)
    // base = per-minute × minutes
    expect(applyEdlBaseCredits(oneSegment(190_000))).toBe(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 4)
  })

  it("reserves on the OVERLAP-COMPRESSED duration (a crossfade shortens the bill)", () => {
    const edl = buildEffectiveEdl(
      {
        version: 1,
        clock: "master",
        sources: [{ id: "A", url: "u", kind: "video" }],
        segments: [
          { id: "s0", inMs: 0, outMs: 60_000, video: "A", audio: "A" },
          { id: "s1", inMs: 0, outMs: 60_000, video: "A", audio: "A", transition: { type: "crossfade", durationMs: 30_000 } },
        ],
      },
      {},
    )
    // 60000 + 60000 − 30000 = 90000 ms → 2 minutes.
    expect(edlDurationMs(edl)).toBe(90_000)
    expect(applyEdlReserveMinutes(edl)).toBe(2)
  })
})

describe("buildEffectiveEdl — default crossfade injection", () => {
  const two = (segTwoTransition?: Edl["segments"][number]["transition"]): unknown => ({
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "u", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 10_000, video: "A", audio: "A" },
      { id: "s1", inMs: 0, outMs: 600, video: "A", audio: "A", ...(segTwoTransition ? { transition: segTwoTransition } : {}) },
    ],
  })

  it("injects a crossfade on a boundary with no transition, clamped to floor(0.9·min(adjacent))", () => {
    const edl = buildEffectiveEdl(two(), { crossfadeMs: 5000 })
    // min(adjacent) = min(10000, 600) = 600 → floor(0.9·600) = 540.
    expect(edl.segments[1].transition).toEqual({ type: "crossfade", durationMs: 540 })
    // The clamp keeps the result VALID (the R5 promise: never inject a blend
    // validateEdl would then reject).
    expect(validateEdl(edl).ok).toBe(true)
  })

  it("never overwrites an EXPLICIT transition with the node default", () => {
    const edl = buildEffectiveEdl(two({ type: "cut" }), { crossfadeMs: 5000 })
    expect(edl.segments[1].transition?.type).toBe("cut")
  })

  it("crossfadeMs 0 (default) leaves hard cuts", () => {
    const edl = buildEffectiveEdl(two(), {})
    expect(edl.segments[1].transition).toBeUndefined()
    expect(edlDurationMs(edl)).toBe(10_600)
  })
})

describe("buildEffectiveEdl — positional source overrides", () => {
  it("replaces EdlSource[i].url in edge order, leaving unspecified sources intact", () => {
    const raw: unknown = {
      version: 1,
      clock: "master",
      sources: [
        { id: "A", url: "https://orig/a.mp4", kind: "video" },
        { id: "B", url: "https://orig/b.mp4", kind: "video" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }],
    }
    const edl = buildEffectiveEdl(raw, { sourceOverrides: [undefined, "https://new/b.mp4"] })
    expect(edl.sources[0].url).toBe("https://orig/a.mp4")
    expect(edl.sources[1].url).toBe("https://new/b.mp4")
  })
})

describe("validateEffectiveEdl — output-aware picture requirement", () => {
  const pictureless: Edl = {
    version: 1,
    clock: "master",
    sources: [{ id: "M", url: "https://m.test/m.m4a", kind: "audio", role: "master-audio" }],
    segments: [{ id: "s0", inMs: 0, outMs: 2000, audio: "M" }],
  }

  it("rejects a picture-less segment for a VIDEO output", () => {
    const r = validateEffectiveEdl(pictureless, "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => /no video source/.test(i))).toBe(true)
  })

  it("accepts the same EDL for an AUDIO output", () => {
    expect(validateEffectiveEdl(pictureless, "audio").ok).toBe(true)
  })

  it("names an unresolvable source url rather than passing it to the renderer", () => {
    const edl = buildEffectiveEdl(
      {
        version: 1,
        clock: "master",
        sources: [{ id: "A", url: "", kind: "video" }],
        segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }],
      },
      {},
    )
    const r = validateEffectiveEdl(edl, "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.includes("A"))).toBe(true)
  })
})
