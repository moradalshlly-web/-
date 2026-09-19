import { describe, it, expect } from "vitest"
import {
  captionRoutesToRemotion,
  resolveCaptionLevers,
  KINETIC_ONLY_CAPTION_LEVER_KEYS,
  KINETIC_CAPTION_STYLES,
} from "../caption-styles.js"

type RouteInput = Parameters<typeof captionRoutesToRemotion>[0]

// ---------------------------------------------------------------------------
// KINETIC_ONLY_CAPTION_LEVER_KEYS — the two levers meaningless on a subtitle
// render (no per-word spoken cursor to colour, no motion to switch off). The
// route rejects exactly these on `subtitle`; the frontend "don't send a stale
// lever" strip and the config panel derive from the SAME constant.
// ---------------------------------------------------------------------------
describe("KINETIC_ONLY_CAPTION_LEVER_KEYS", () => {
  it("is exactly [highlightColor, animate]", () => {
    expect(KINETIC_ONLY_CAPTION_LEVER_KEYS).toEqual(["highlightColor", "animate"])
  })
})

// ---------------------------------------------------------------------------
// captionRoutesToRemotion — the SINGLE predicate that decides the Remotion vs
// FFmpeg-drawtext path for both the worker dispatch and the credit id. Every
// branch of its contract is pinned below; the sole FALSE case is a plain-text
// subtitle with no lever / transcript / captions / segments.
// ---------------------------------------------------------------------------
describe("captionRoutesToRemotion", () => {
  it("FALSE for a plain-text subtitle (the cheap FFmpeg drawtext path)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hello world" })).toBe(false)
    // style unset → the subtitle default, still the FFmpeg path with plain text.
    expect(captionRoutesToRemotion({ text: "hello world" })).toBe(false)
  })

  it("TRUE when non-empty segments are present (per-segment treatments)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", segments: [{}] })).toBe(true)
  })
  it("segments WIN even alongside plain text", () => {
    expect(captionRoutesToRemotion({ text: "hello", segments: [{ startMs: 0, endMs: 1 }] })).toBe(true)
  })
  it("an EMPTY segments array does not route (length 0)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", segments: [] })).toBe(false)
  })

  it("TRUE for EVERY kinetic style, even with no other lever", () => {
    for (const style of KINETIC_CAPTION_STYLES) {
      expect(captionRoutesToRemotion({ style, text: "hi" }), style).toBe(true)
    }
  })

  it("TRUE for a subtitle carrying ANY single styling lever", () => {
    const leverInputs: RouteInput[] = [
      { style: "subtitle", text: "hi", look: "outline" },
      { style: "subtitle", text: "hi", fontFamily: "Montserrat" },
      { style: "subtitle", text: "hi", fontWeight: 900 },
      { style: "subtitle", text: "hi", strokeColor: "#000000" },
      { style: "subtitle", text: "hi", strokeWidth: 6 },
      { style: "subtitle", text: "hi", uppercase: true },
      { style: "subtitle", text: "hi", positionY: 65 },
    ]
    for (const input of leverInputs) {
      expect(captionRoutesToRemotion(input), JSON.stringify(input)).toBe(true)
    }
  })

  it("routes on lever PRESENCE (!== undefined), not truthiness — legitimate zero/false values still route", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", strokeWidth: 0 })).toBe(true)   // 0 = "no outline"
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", positionY: 0 })).toBe(true)     // top of frame
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", uppercase: false })).toBe(true) // explicitly not caps
  })

  it("TRUE for a subtitle with a wired transcript (timed captions need Remotion)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", transcript: { words: [] } })).toBe(true)
    expect(captionRoutesToRemotion({ style: "subtitle", transcript: { version: 1 } })).toBe(true)
  })
  it("a NULL transcript alongside plain text does NOT route (null is not a wired transcript)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", transcript: null })).toBe(false)
  })

  it("TRUE for a subtitle with a non-empty captions[]", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", captions: [{ text: "a", startMs: 0, endMs: 1 }] })).toBe(true)
  })
  it("an EMPTY captions[] alongside plain text does NOT route", () => {
    expect(captionRoutesToRemotion({ style: "subtitle", text: "hi", captions: [] })).toBe(false)
  })

  it("TRUE for a subtitle with NO text (the only caption source is transcription → timed captions)", () => {
    expect(captionRoutesToRemotion({ style: "subtitle" })).toBe(true)
    expect(captionRoutesToRemotion({ style: "subtitle", text: "" })).toBe(true)
    expect(captionRoutesToRemotion({ style: "subtitle", text: null })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The add-captions credit id is derived 1:1 from this predicate on BOTH backend
// call sites (routes/add-captions.ts::buildAddCaptionsCreditId and the DAG
// payload-builder): captionRoutesToRemotion(req) ? "add-captions:kinetic" :
// "add-captions". Covering the mapping through the shared predicate is what keeps
// the price and the renderer from drifting (a Remotion render must never reserve
// the static FFmpeg price, and vice-versa).
// ---------------------------------------------------------------------------
describe("add-captions credit id maps 1:1 from captionRoutesToRemotion", () => {
  const creditId = (input: RouteInput): string =>
    captionRoutesToRemotion(input) ? "add-captions:kinetic" : "add-captions"

  it("a plain-text subtitle bills as add-captions (cheap FFmpeg burn)", () => {
    expect(creditId({ style: "subtitle", text: "hello world" })).toBe("add-captions")
  })

  it("kinetic / styled / timed / segmented all bill as add-captions:kinetic (Remotion render)", () => {
    expect(creditId({ style: "word-pop", text: "hi" })).toBe("add-captions:kinetic")
    expect(creditId({ style: "subtitle", text: "hi", look: "outline" })).toBe("add-captions:kinetic")
    expect(creditId({ style: "subtitle", text: "hi", transcript: { words: [{}] } })).toBe("add-captions:kinetic")
    expect(creditId({ style: "subtitle", text: "hi", captions: [{ text: "a", startMs: 0, endMs: 1 }] })).toBe("add-captions:kinetic")
    expect(creditId({ style: "subtitle", text: "hi", segments: [{}] })).toBe("add-captions:kinetic")
  })
})

describe("resolveCaptionLevers — per-style default look (kinetic → outline, subtitle → clean)", () => {
  it("a bare subtitle (no look) resolves the CLEAN preset — a pinned sans, no outline house-style", () => {
    const out = resolveCaptionLevers("subtitle", undefined, { color: "#fff", uppercase: true }, 32)
    // A face is ALWAYS pinned: with none, the Remotion render falls back to
    // headless Chrome's default serif (the plain FFmpeg subtitle draws sans).
    expect(out.fontFamily).toBe("Inter")
    expect(out).toEqual({ fontFamily: "Inter", color: "#fff", uppercase: true })
    expect(out.strokeWidth).toBeUndefined() // did NOT inherit the outline stroke
    expect(out.highlightColor).toBeUndefined() // nor the outline spoken-word colour
  })

  it("an unset style is treated as subtitle (the route default) → clean", () => {
    expect(resolveCaptionLevers(undefined, undefined, {}, 32).fontFamily).toBe("Inter")
  })

  it("a subtitle that NAMES a look resolves that preset", () => {
    const out = resolveCaptionLevers("subtitle", "outline", {}, 32)
    expect(out.fontFamily).toBe("Montserrat")
    expect(out.uppercase).toBe(true)
    expect(out.strokeWidth).toBeGreaterThan(0)
  })

  it("a kinetic style with no look resolves the default (outline) preset", () => {
    const out = resolveCaptionLevers("word-highlight", undefined, {}, 32)
    expect(out.fontFamily).toBe("Montserrat")
    expect(out.highlightColor).toBeDefined()
  })

  it("explicit levers override the resolved preset", () => {
    const out = resolveCaptionLevers("word-highlight", "outline", { fontFamily: "Anton", uppercase: false }, 32)
    expect(out.fontFamily).toBe("Anton")
    expect(out.uppercase).toBe(false)
  })
})
