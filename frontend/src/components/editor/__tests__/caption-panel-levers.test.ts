import { describe, it, expect } from "vitest"
import { resolveCaptionPanelLevers } from "../caption-panel-levers"
import { CAPTION_LOOKS, DEFAULT_CAPTION_LOOK } from "@nodaro/shared"

// Guards that the frontend render-mirror stays faithful to the worker
// (backend/src/workers/handlers/ffmpeg.ts `topLevers`, ~L825). If that rule
// changes, this fails and points at the helper — the panel + preview both flow
// through it.
describe("resolveCaptionPanelLevers", () => {
  const FS = 32

  it("bare subtitle (no look) stays PLAIN — explicit levers only, no preset", () => {
    expect(resolveCaptionPanelLevers("subtitle", undefined, {}, FS)).toEqual({})
    const out = resolveCaptionPanelLevers("subtitle", undefined, { strokeColor: "#123456" }, FS)
    expect(out).toEqual({ strokeColor: "#123456" })
    // no outline house-style leaks onto a bare subtitle
    expect(out.uppercase).toBeUndefined()
    expect(out.fontFamily).toBeUndefined()
  })

  it("subtitle that NAMES a look resolves that preset", () => {
    const out = resolveCaptionPanelLevers("subtitle", "outline", {}, FS)
    expect(out).toEqual(CAPTION_LOOKS.outline(FS))
    expect(out.uppercase).toBe(true)
  })

  it("a kinetic style with no look resolves the default preset", () => {
    expect(resolveCaptionPanelLevers("word-highlight", undefined, {}, FS)).toEqual(
      CAPTION_LOOKS[DEFAULT_CAPTION_LOOK](FS),
    )
  })

  it("an explicit lever overrides the resolved preset, others keep the preset value", () => {
    const out = resolveCaptionPanelLevers("karaoke", "outline", { uppercase: false, highlightColor: "#abcdef" }, FS)
    expect(out.uppercase).toBe(false)
    expect(out.highlightColor).toBe("#abcdef")
    expect(out.fontFamily).toBe("Montserrat")
  })
})
