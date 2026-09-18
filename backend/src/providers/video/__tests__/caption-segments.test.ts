import { describe, it, expect } from "vitest"
import type { Caption } from "@remotion/captions"
import { resolveCaptionSegments, findSegmentOverlap, type CaptionStyleDefaults } from "../caption-segments.js"
import { burnCaptionsPlanSchema } from "../../../lib/plan-schemas.js"

// Top-level defaults a segment inherits when it omits a field. `look: "clean"`
// + a distinctive top-level explicit lever (`highlightColor`) lets the cascade
// tests below tell "inherited the top-level explicit" from "started fresh".
const DEFAULTS: CaptionStyleDefaults = {
  style: "word-pop",
  position: "bottom",
  fontSize: 32,
  look: "clean",
  // color + backgroundColor are BASE fields (always inherit); highlightColor is a
  // LOOK lever (resets when a segment names its own look).
  explicit: { color: "#ffffff", backgroundColor: "#101010", highlightColor: "#00ff00" },
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

describe("resolveCaptionSegments — words", () => {
  it("filters the shared transcript to each segment's time range (kinetic → per-word)", () => {
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

  it("M1: a SUBTITLE segment joins the shared range into ONE phrase block spanning its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle" }],
      DEFAULTS,
    )
    // One caption, not per-word — the static/subtitle read is a whole phrase.
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]!.text).toBe("same face")
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[0]!.endMs).toBe(3000)
  })

  it("uses a segment's own text: kinetic synthesises per-word across its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, text: "Same face, every shot." }],
      DEFAULTS,
    )
    expect(seg!.captions.map((c) => c.text.trim())).toEqual(["Same", "face,", "every", "shot."])
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[seg!.captions.length - 1]!.endMs).toBe(3000)
  })

  it("M1: a SUBTITLE segment's own text is ONE block (not per-word) spanning its range", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle", text: "  Same face, every shot.  " }],
      DEFAULTS,
    )
    expect(seg!.captions).toHaveLength(1)
    expect(seg!.captions[0]!.text).toBe("Same face, every shot.") // trimmed
    expect(seg!.captions[0]!.startMs).toBe(0)
    expect(seg!.captions[0]!.endMs).toBe(3000)
  })

  it("uses a segment's own captions[] (over the shared transcript) when provided", () => {
    const own = [cap("HOOK", 100, 900)]
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, captions: own }], DEFAULTS)
    expect(seg!.captions).toEqual(own)
  })

  it("drops a segment's own words that START outside its range (a held line must not leak them in)", () => {
    // Absolute-ms captions handed to segment B [5000, 10000): "Intro"/"title"
    // belong to the previous range. The line-based overlays hold a line through
    // gaps, so left in the list they would show at 5000 as a held/straddling line.
    const own = [cap("Intro", 4000, 4400), cap("title", 4500, 4800), cap("body", 5300, 5600), cap("starts", 5600, 6000)]
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 5000, endMs: 10000, captions: own }], DEFAULTS)
    expect(seg!.captions.map((c) => c.text)).toEqual(["body", "starts"])
    // A word that starts inside and ends outside stays with the segment it started in.
    const [edge] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, captions: [cap("mid", 2800, 3200)] }], DEFAULTS)
    expect(edge!.captions.map((c) => c.text)).toEqual(["mid"])
  })

  it("assigns a straddling shared word to the ONE segment its start falls in (no mid-word style jump)", () => {
    const straddle = [cap("mid", 2800, 3200)] // starts in A, ends in B
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
})

describe("resolveCaptionSegments — look cascade", () => {
  it("style/placement: segment override wins, otherwise inherits the top-level default", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96 }],
      DEFAULTS,
    )
    expect(seg!.style).toBe("subtitle")
    expect(seg!.position).toBe("top")
    expect(seg!.fontSize).toBe(96)
  })

  it("a segment WITHOUT its own look inherits the top-level look AND the top-level explicit levers", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000 }], DEFAULTS)
    // Inherited look = clean (Inter) + inherited top-level explicit highlightColor.
    expect(seg!.fontFamily).toBe("Inter")
    expect(seg!.highlightColor).toBe("#00ff00")
    expect(seg!.color).toBe("#ffffff")
  })

  it("a segment's OWN explicit lever wins over the inherited TOP-LEVEL explicit lever (precedence, not merge)", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      // highlightColor is ALSO set on the top-level defaults (#00ff00); the
      // segment's own value must win — a swapped spread would leak #00ff00.
      [{ startMs: 0, endMs: 3000, uppercase: true, strokeColor: "#123456", strokeWidth: 8, highlightColor: "#ff00ff" }],
      DEFAULTS,
    )
    expect(seg!.uppercase).toBe(true)
    expect(seg!.strokeColor).toBe("#123456")
    expect(seg!.strokeWidth).toBe(8)
    expect(seg!.highlightColor).toBe("#ff00ff") // segment's own, not the top-level #00ff00
  })

  it("FOOTGUN: a segment that names its OWN look resets the LOOK levers — it does NOT inherit the top-level ones", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], DEFAULTS)
    // outline's own highlight (#FFE600), NOT the top-level explicit #00ff00.
    expect(seg!.highlightColor).toBe("#FFE600")
    expect(seg!.fontFamily).toBe("Montserrat")
    expect(seg!.uppercase).toBe(true)
    expect(seg!.strokeColor).toBe("#000000")
  })

  it("BUT base fields (color / backgroundColor) still inherit through a segment's own look", () => {
    const [seg] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], DEFAULTS)
    // color/backgroundColor are base caption fields, not look levers — they carry
    // the top-level value even when the segment picks its own look.
    expect(seg!.backgroundColor).toBe("#101010")
    // outline sets color:#ffffff, and the top-level base is also #ffffff; assert a
    // DISTINCT top-level base survives too.
    const [seg2] = resolveCaptionSegments(SHARED, [{ startMs: 0, endMs: 3000, look: "outline" }], {
      ...DEFAULTS,
      explicit: { color: "#abcdef", backgroundColor: "#101010" },
    })
    expect(seg2!.color).toBe("#abcdef") // inherited base beats outline's own #ffffff
    expect(seg2!.backgroundColor).toBe("#101010")
  })

  it("a segment with its OWN look still applies its OWN explicit override on top of that look", () => {
    const [seg] = resolveCaptionSegments(
      SHARED,
      [{ startMs: 0, endMs: 3000, look: "outline", highlightColor: "#ff00ff" }],
      DEFAULTS,
    )
    expect(seg!.highlightColor).toBe("#ff00ff") // own explicit wins over own look
    expect(seg!.fontFamily).toBe("Montserrat") // rest still from outline
  })
})

describe("resolveCaptionSegments — plan contract", () => {
  it("resolved segments validate against the render plan schema (resolver ↔ plan contract)", () => {
    const segments = resolveCaptionSegments(
      SHARED,
      [
        { startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, look: "outline", text: "Same face." },
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
    expect(burnCaptionsPlanSchema.safeParse({ ...base, captions: [], segments }).success).toBe(true)
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
