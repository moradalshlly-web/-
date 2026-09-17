import { describe, it, expect } from "vitest"
import { captionTop, captionLookStyle } from "../caption-look"
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
