import { describe, it, expect } from "vitest"
import { captionTop, captionLookStyle, captionWord } from "../caption-look"
import { POSITION_Y } from "../overlay-position"
import { FONT_MAP, withRtlFallback } from "../font-registry"

describe("captionTop", () => {
  it("falls back to the named slot when positionY is unset (byte-identical default)", () => {
    expect(captionTop("top")).toBe(POSITION_Y.top)
    expect(captionTop("center")).toBe(POSITION_Y.center)
    expect(captionTop("bottom")).toBe(POSITION_Y.bottom)
  })
  it("positionY wins over the named slot", () => {
    expect(captionTop("bottom", 65)).toBe("65%")
    expect(captionTop("top", 0)).toBe("0%")
  })
  it("clamps positionY to 0-100", () => {
    expect(captionTop("bottom", -10)).toBe("0%")
    expect(captionTop("bottom", 150)).toBe("100%")
  })
  it("NaN positionY falls back to the named slot", () => {
    expect(captionTop("center", Number.NaN)).toBe(POSITION_Y.center)
  })
})

describe("captionLookStyle", () => {
  it("returns an empty object when no lever is set (spread is a no-op)", () => {
    expect(captionLookStyle({})).toEqual({})
  })
  it("uppercase → textTransform", () => {
    expect(captionLookStyle({ uppercase: true })).toEqual({ textTransform: "uppercase" })
  })
  it("resolves a known font to its loaded family + RTL fallback", () => {
    expect(captionLookStyle({ fontFamily: "Montserrat" }).fontFamily).toBe(
      withRtlFallback(FONT_MAP["Montserrat"]),
    )
  })
  it("disables font-synthesis ONLY when a face is chosen (no faux-bold on single-weight faces)", () => {
    // Anton loads weight 400 only; the overlays request 700-900, so without
    // fontSynthesis:none Chrome would synthesise a faux-bold.
    expect(captionLookStyle({ fontFamily: "Anton" }).fontSynthesis).toBe("none")
    // Not present on the default path (byte-identical when no font is chosen).
    expect(captionLookStyle({}).fontSynthesis).toBeUndefined()
    expect(captionLookStyle({ uppercase: true }).fontSynthesis).toBeUndefined()
    expect(captionLookStyle({ strokeWidth: 4 }).fontSynthesis).toBeUndefined()
  })
  it("passes an unknown font name through (never hard-blocks a typo)", () => {
    expect(captionLookStyle({ fontFamily: "Nonesuch" }).fontFamily).toBe(withRtlFallback("Nonesuch"))
  })
  it("stroke: width + default black, painted behind the glyph", () => {
    expect(captionLookStyle({ strokeWidth: 4 })).toMatchObject({
      WebkitTextStrokeWidth: "4px",
      WebkitTextStrokeColor: "#000000",
      paintOrder: "stroke fill",
    })
  })
  it("stroke honours an explicit colour", () => {
    expect(captionLookStyle({ strokeWidth: 6, strokeColor: "#112233" }).WebkitTextStrokeColor).toBe("#112233")
  })
  it("strokeWidth 0 / unset draws no outline", () => {
    expect(captionLookStyle({ strokeWidth: 0 })).toEqual({})
    expect(captionLookStyle({ strokeColor: "#000000" })).toEqual({})
  })
  it("highlightColor is not a container-level style (it is applied per-word by the overlays)", () => {
    expect(captionLookStyle({ highlightColor: "#ff0000" })).toEqual({})
  })
})

describe("captionWord — inter-word spacing (Bug: glued word-level captions)", () => {
  it("the first word in a row has no leading space", () => {
    expect(captionWord("face", 0)).toBe("face")
  })
  it("bare word-level input (no delimiter) gets a single separating space", () => {
    // The reported failure: {text:"face"},{text:"doesn't"},{text:"drift."} rendered
    // as "facedoesn'tdrift." — each non-first word must carry one leading space.
    expect(captionWord("doesn't", 1)).toBe(" doesn't")
    expect(captionWord("drift.", 2)).toBe(" drift.")
  })
  it("delimited transcription input (leading space) is normalised to exactly one space", () => {
    expect(captionWord(" word", 1)).toBe(" word")
    expect(captionWord("  word  ", 3)).toBe(" word")
  })
  it("trims a delimiter off the first word too", () => {
    expect(captionWord(" word", 0)).toBe("word")
  })
  it("a full row joins into readable, single-spaced text", () => {
    const words = ["face", "doesn't", "drift.", "Not", "once."]
    expect(words.map((w, i) => captionWord(w, i)).join("")).toBe("face doesn't drift. Not once.")
  })
})
