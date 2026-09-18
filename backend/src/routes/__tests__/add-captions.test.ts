import { describe, it, expect } from "vitest"
import { addCaptionsBody } from "../add-captions.js"

const VIDEO = "https://example.com/clip.mp4"

type ParseResult = ReturnType<typeof addCaptionsBody.safeParse>
function issuePaths(result: ParseResult): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.map(String).join("."))
}

describe("addCaptionsBody — look levers gate on kinetic style", () => {
  it("accepts a kinetic style with the full look (incl. look preset + fontWeight)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello world",
      style: "tiktok-words",
      look: "outline",
      fontFamily: "Montserrat",
      fontWeight: 900,
      strokeColor: "#000000",
      strokeWidth: 6,
      highlightColor: "#22ff88",
      uppercase: true,
      positionY: 65,
    })
    expect(r.success).toBe(true)
  })

  it("rejects a look lever on the static subtitle style (the FFmpeg path ignores it)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello",
      // style omitted → defaults to "subtitle" (non-kinetic)
      fontFamily: "Montserrat",
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("fontFamily")
  })

  it("rejects every look lever at once on subtitle, each with its own path", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hi",
      style: "subtitle",
      look: "outline",
      fontFamily: "Anton",
      fontWeight: 700,
      strokeColor: "#000000",
      strokeWidth: 4,
      highlightColor: "#fff",
      uppercase: true,
      positionY: 50,
    })
    expect(r.success).toBe(false)
    const paths = issuePaths(r)
    for (const k of ["look", "fontFamily", "fontWeight", "strokeColor", "strokeWidth", "highlightColor", "uppercase", "positionY"]) {
      expect(paths).toContain(k)
    }
  })

  it("rejects the look preset on subtitle (it selects levers the FFmpeg path can't apply)", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "subtitle", look: "outline" })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("look")
  })

  it("rejects a fontWeight that is not a 100-step (100–900) even on a kinetic style", () => {
    const notStep = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", fontWeight: 650 })
    expect(notStep.success).toBe(false)
    expect(issuePaths(notStep)).toContain("fontWeight")
    const outOfRange = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", fontWeight: 1000 })
    expect(outOfRange.success).toBe(false)
    const unknownLook = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", look: "sparkles" })
    expect(unknownLook.success).toBe(false)
    expect(issuePaths(unknownLook)).toContain("look")
  })

  it("plain subtitle with no look still parses", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hello" })
    expect(r.success).toBe(true)
  })

  it("rejects an unknown font face on a kinetic style", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hi",
      style: "karaoke",
      fontFamily: "NotARealFont",
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("fontFamily")
  })

  it("accepts word-level captions[] omitting timestampMs/confidence (now optional)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-highlight",
      captions: [
        { text: "face", startMs: 0, endMs: 300 },
        { text: "doesn't", startMs: 300, endMs: 700 },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      // Omitted fields default to null (a valid @remotion/captions Caption).
      expect(r.data.captions?.[0]?.timestampMs).toBeNull()
      expect(r.data.captions?.[0]?.confidence).toBeNull()
    }
  })

  it("still requires a caption source", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "tiktok-words",
      auto_transcribe: false,
    })
    expect(r.success).toBe(false)
  })
})

describe("addCaptionsBody — Transcript input + wordLevel", () => {
  const TRANSCRIPT = { version: 1, words: [{ text: "hello", startMs: 0, endMs: 300 }] }

  it("accepts a transcript on a kinetic style, with wordLevel", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "karaoke",
      transcript: TRANSCRIPT,
      wordLevel: true,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.wordLevel).toBe(true)
  })

  it("a transcript is a caption source on its own (auto_transcribe:false, no text)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-pop",
      auto_transcribe: false,
      transcript: TRANSCRIPT,
    })
    expect(r.success).toBe(true)
  })

  it("rejects a transcript on the static subtitle style (timed captions need Remotion)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // style omitted → defaults to "subtitle" (non-kinetic)
      transcript: TRANSCRIPT,
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("transcript")
  })

  it("accepts a transcript alongside segments regardless of top-level style (all-Remotion render)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcript: TRANSCRIPT,
      segments: [{ startMs: 0, endMs: 3000 }],
    })
    expect(r.success).toBe(true)
  })
})

describe("addCaptionsBody — per-segment captions", () => {
  it("accepts non-overlapping segments with per-segment style/position/look + own text", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [
        { startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, look: "outline", fontFamily: "Anton", fontWeight: 400, text: "Same face, every shot. No re-prompting." },
        { startMs: 3000, endMs: 12000, style: "word-pop", position: "bottom", fontSize: 48, look: "clean", uppercase: true, text: "Studio. Drift. Not once." },
      ],
    })
    // A look lever on a subtitle SEGMENT is fine — a segmented render is all
    // Remotion, so the subtitle overlay honours it (unlike the static path).
    expect(r.success).toBe(true)
  })

  it("rejects an invalid per-segment look/fontWeight (segment schema mirrors the top-level constraints)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 0, endMs: 3000, look: "sparkles", fontWeight: 650, text: "x" }],
    })
    expect(r.success).toBe(false)
  })

  it("rejects overlapping segments", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [
        { startMs: 0, endMs: 4000, text: "a" },
        { startMs: 3000, endMs: 8000, text: "b" },
      ],
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("segments")
  })

  it("rejects a segment whose endMs is not after startMs", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 3000, endMs: 3000, text: "x" }],
    })
    expect(r.success).toBe(false)
  })

  it("allows a top-level look lever with segments present (segmented render is all Remotion, so no subtitle rejection)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // style defaults to subtitle; with segments the top-level uppercase is a
      // default for segments, not a rejected FFmpeg-path lever.
      uppercase: true,
      segments: [{ startMs: 0, endMs: 3000, text: "hi" }],
    })
    expect(r.success).toBe(true)
  })

  it("requires a source: rejects self-unsourced segments with no shared transcript", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false, // no shared transcript
      segments: [
        { startMs: 0, endMs: 3000, text: "has text" },
        { startMs: 3000, endMs: 6000 }, // no own text/captions AND no shared source
      ],
    })
    expect(r.success).toBe(false)
  })

  it("accepts self-unsourced segments when a shared transcript is available", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // auto_transcribe defaults to attempted → shared transcript available.
      segments: [{ startMs: 0, endMs: 3000 }],
    })
    expect(r.success).toBe(true)
  })

  it("rejects whitespace-only segment text (would synthesise to zero words → render fail)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 0, endMs: 3000, text: "   " }],
    })
    expect(r.success).toBe(false)
  })

  it("rejects whitespace-only top-level text", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, style: "word-pop", text: "\t \n" })
    expect(r.success).toBe(false)
  })
})
