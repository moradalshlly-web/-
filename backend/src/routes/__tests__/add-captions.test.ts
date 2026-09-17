import { describe, it, expect } from "vitest"
import { addCaptionsBody } from "../add-captions.js"

const VIDEO = "https://example.com/clip.mp4"

type ParseResult = ReturnType<typeof addCaptionsBody.safeParse>
function issuePaths(result: ParseResult): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.map(String).join("."))
}

describe("addCaptionsBody — look levers gate on kinetic style", () => {
  it("accepts a kinetic style with the full look", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello world",
      style: "tiktok-words",
      fontFamily: "Montserrat",
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
      strokeColor: "#000000",
      strokeWidth: 4,
      highlightColor: "#fff",
      uppercase: true,
      positionY: 50,
    })
    expect(r.success).toBe(false)
    const paths = issuePaths(r)
    for (const k of ["strokeColor", "strokeWidth", "highlightColor", "uppercase", "positionY"]) {
      expect(paths).toContain(k)
    }
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

  it("still requires a caption source", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "tiktok-words",
      auto_transcribe: false,
    })
    expect(r.success).toBe(false)
  })
})
