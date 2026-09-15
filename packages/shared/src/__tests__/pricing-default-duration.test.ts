import { describe, it, expect } from "vitest"
import { PRICING_DEFAULT_DURATION_SEC, pricedOutputDurationSec } from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

/**
 * #1397: a request that names a provider but omits `duration` renders the
 * provider's OWN default, so it must be priced — identifier tier AND every
 * reservation that scales by output seconds — at that default, never at a
 * literal 5. `pricedOutputDurationSec` is the one source both read.
 */
describe("pricedOutputDurationSec", () => {
  it("the requested duration wins, as a number or a numeric string", () => {
    expect(pricedOutputDurationSec("seedance-2-5", 12)).toBe(12)
    expect(pricedOutputDurationSec("seedance-2-5", "12")).toBe(12)
    expect(pricedOutputDurationSec("minimax-h3", 4)).toBe(4)
  })

  it("an omitted duration prices the provider's declared default render length", () => {
    expect(pricedOutputDurationSec("seedance-2-5", undefined)).toBe(8)
    expect(pricedOutputDurationSec("grok-imagine-video-1.5", undefined)).toBe(8)
    expect(pricedOutputDurationSec("minimax-h3", undefined)).toBe(6)
    expect(PRICING_DEFAULT_DURATION_SEC["seedance-2-5"]).toBe(8)
  })

  it("a provider with no declared default keeps the historical 5s fallback", () => {
    expect(pricedOutputDurationSec("seedance-2", undefined)).toBe(5)
    expect(pricedOutputDurationSec("kling", undefined)).toBe(5)
  })

  it("an unparseable duration falls back the same way", () => {
    expect(pricedOutputDurationSec("seedance-2-5", "abc")).toBe(8)
    expect(pricedOutputDurationSec("seedance-2", "abc")).toBe(5)
  })

  it("the identifier tier for an omitted duration is the default's tier, not the 5s one (seedance-2-5)", () => {
    for (const nodeType of ["image-to-video", "text-to-video"] as const) {
      expect(buildVideoCreditModelIdentifier("seedance-2-5", undefined, undefined, nodeType, undefined, "720p")).toBe(
        buildVideoCreditModelIdentifier("seedance-2-5", 8, undefined, nodeType, undefined, "720p"),
      )
      expect(buildVideoCreditModelIdentifier("seedance-2-5", undefined, undefined, nodeType, undefined, "720p", true)).toBe(
        "seedance-2-5:8s:720p-ref",
      )
    }
  })
})
