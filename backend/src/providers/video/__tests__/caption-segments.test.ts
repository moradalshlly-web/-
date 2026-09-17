import { describe, it, expect } from "vitest"
import type { Caption } from "@remotion/captions"
import { resolveCaptionSegments, findSegmentOverlap, type CaptionStyleDefaults } from "../caption-segments.js"
import { burnCaptionsPlanSchema } from "../../../lib/plan-schemas.js"

const DEFAULTS: CaptionStyleDefaults = {
  style: "word-pop",
  position: "bottom",
  fontSize: 32,
  color: "#ffffff",
}

function cap(text: string, startMs: number, endMs: number): Caption {
  return { text, startMs, endMs, timestampMs: startMs, confidence: null }
}

const SHARED: Caption[] = [
  cap("same", 0, 500),
  cap("face", 500, 1000),
  cap("studio", 4000, 4500),
  cap("drift", 8000, 8500),
]

describe("resolveCaptionSegments", () => {
  it("filters the shared transcript to each segment's time range when the segment has no own text", () => {
    const [intro, body] = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 3000 },
        { startMs: 3000, endMs: 9000 },
      ],
      DEFAULTS,
    )
    expect(intro!.captions.map((c) => c.text)).toEqual(["same", "face"])
    expect(body!.captions.map((c) => c.text)).toEqual(["studio", "drift"])
  })

  it("uses a segment's own text (synthesised across its range) over the shared transcript", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, text: "Same face, every shot." }],
      DEFAULTS,
    )
    expect(seg!.captions.map((c) => c.text.trim())).toEqual(["Same", "face,", "every", "shot."])
    // Synthesised inside the segment's range.
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[seg!.captions.length - 1]!.endMs).toBe(3000)
  })

  it("uses a segment's own captions[] verbatim when provided", () => {
    const own = [cap("HOOK", 100, 900)]
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, captions: own }], DEFAULTS)
    expect(seg!.captions).toBe(own)
  })

  it("merges style/look: segment override wins, otherwise inherits the top-level default", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, uppercase: true, strokeColor: "#000000", strokeWidth: 8 }],
      DEFAULTS,
    )
    expect(seg!.style).toBe("subtitle") // overridden
    expect(seg!.position).toBe("top") // overridden
    expect(seg!.fontSize).toBe(96) // overridden
    expect(seg!.uppercase).toBe(true)
    expect(seg!.strokeColor).toBe("#000000")
    expect(seg!.strokeWidth).toBe(8)
    expect(seg!.color).toBe("#ffffff") // inherited default
  })

  it("assigns a straddling shared word to the ONE segment its start falls in (no mid-word style jump)", () => {
    const straddle = [cap("mid", 2800, 3200)] // starts in segment A, ends in segment B
    const [a, b] = resolveCaptionSegments(
      straddle,
      [
        { startMs: 0, endMs: 3000 },
        { startMs: 3000, endMs: 6000 },
      ],
      DEFAULTS,
    )
    expect(a!.captions.map((c) => c.text)).toEqual(["mid"])
    expect(b!.captions.map((c) => c.text)).toEqual([])
  })

  it("resolved segments validate against the render plan schema (resolver ↔ plan contract)", () => {
    const segments = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, uppercase: true, strokeColor: "#000000", strokeWidth: 8, text: "Same face." },
        { startMs: 3000, endMs: 9000, style: "word-pop", position: "bottom", fontSize: 48 },
      ],
      DEFAULTS,
    )
    const plan = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      captions: SHARED,
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      segments,
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 300,
    }
    expect(burnCaptionsPlanSchema.safeParse(plan).success).toBe(true)
  })

  it("plan allows EMPTY top-level captions when segments carry the words (no post-reservation render fail)", () => {
    const segments = resolveCaptionSegments([], [{ startMs: 0, endMs: 3000, text: "Hello there." }], DEFAULTS)
    const base = {
      planType: "burn-captions" as const,
      sourceVideo: "https://example.com/v.mp4",
      style: "word-pop" as const,
      position: "bottom" as const,
      fontSize: 32,
      color: "#ffffff",
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 90,
    }
    // Empty captions WITH segments → valid.
    expect(burnCaptionsPlanSchema.safeParse({ ...base, captions: [], segments }).success).toBe(true)
    // Empty captions WITHOUT segments → still rejected (min-1 contract preserved).
    expect(burnCaptionsPlanSchema.safeParse({ ...base, captions: [] }).success).toBe(false)
  })
})

describe("findSegmentOverlap", () => {
  it("returns null for non-overlapping (unsorted) segments", () => {
    expect(findSegmentOverlap([{ startMs: 3000, endMs: 6000 }, { startMs: 0, endMs: 3000 }])).toBeNull()
  })
  it("detects an overlap regardless of order", () => {
    expect(findSegmentOverlap([{ startMs: 0, endMs: 4000 }, { startMs: 3000, endMs: 8000 }])).toContain("overlap")
  })
  it("treats touching boundaries (endMs == next startMs) as non-overlapping", () => {
    expect(findSegmentOverlap([{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 6000 }])).toBeNull()
  })
})
