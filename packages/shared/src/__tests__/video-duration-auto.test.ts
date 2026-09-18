import { describe, it, expect } from "vitest"
import {
  VIDEO_DURATION_AUTO,
  isAutoVideoDuration,
  supportsAutoVideoDuration,
  maxVideoDurationSec,
  pricedOutputDurationSec,
  buildVideoCreditModelIdentifier,
  normalizeModelInput,
  validateModelInput,
  MODEL_CATALOG,
  SEEDANCE_2_PROVIDERS,
} from "../index.js"

/**
 * Auto duration (`duration: -1`) — the model picks the clip length. The risk is
 * entirely on the billing side: `commit_credits` refunds a surplus but never
 * collects a deficit, so an Auto run must be PRICED at the longest clip the
 * model can render, on every lane, by default.
 */
describe("auto video duration", () => {
  it("is KIE's own sentinel, from a number or a string", () => {
    expect(VIDEO_DURATION_AUTO).toBe(-1)
    expect(isAutoVideoDuration(-1)).toBe(true)
    expect(isAutoVideoDuration("-1")).toBe(true)
    for (const v of [undefined, null, 0, 1, 8, "8", "auto", NaN]) expect(isAutoVideoDuration(v), String(v)).toBe(false)
  })

  it("is a catalog capability of exactly the Seedance 2 family", () => {
    const declared = Object.keys(MODEL_CATALOG).filter((id) => MODEL_CATALOG[id]!.autoDuration === true).sort()
    expect(declared).toEqual([...SEEDANCE_2_PROVIDERS].sort())
    for (const id of declared) expect(supportsAutoVideoDuration(id)).toBe(true)
    expect(supportsAutoVideoDuration("kling-3.0")).toBe(false)
    expect(supportsAutoVideoDuration(undefined)).toBe(false)
  })

  it("prices at the model's LONGEST clip — the top tier is also the catalog's longest duration", () => {
    for (const id of SEEDANCE_2_PROVIDERS) {
      const ceiling = maxVideoDurationSec(id)!
      expect(ceiling, id).toBe(Math.max(...MODEL_CATALOG[id]!.durations!))
      expect(pricedOutputDurationSec(id, VIDEO_DURATION_AUTO), id).toBe(ceiling)
      expect(pricedOutputDurationSec(id, "-1"), id).toBe(ceiling)
    }
    expect(pricedOutputDurationSec("seedance-2-5", -1)).toBe(30)
    expect(pricedOutputDurationSec("seedance-2", -1)).toBe(15)
  })

  it("never prices the cheapest tier for Auto (the under-reserve this guards)", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2-5", -1, undefined, undefined, undefined, "480p")).toBe("seedance-2-5:30s:480p")
    expect(buildVideoCreditModelIdentifier("seedance-2", -1, undefined, undefined, undefined, "720p", true)).toBe("seedance-2:15s:720p-ref")
  })

  it("a model without the capability prices its render default, not a ceiling it will not render", () => {
    expect(pricedOutputDurationSec("minimax-h3", -1)).toBe(pricedOutputDurationSec("minimax-h3", undefined))
    expect(pricedOutputDurationSec("seedance-2-5", 0)).toBe(pricedOutputDurationSec("seedance-2-5", undefined))
  })

  it("passes the catalog normalizer and validator only where declared", () => {
    expect(normalizeModelInput("seedance-2-5", { duration: -1 }).duration).toBe(-1)
    expect(validateModelInput("seedance-2-5", { duration: -1 })).toBeNull()
    const other = Object.keys(MODEL_CATALOG).find((id) => MODEL_CATALOG[id]!.durations && !MODEL_CATALOG[id]!.autoDuration)!
    expect(normalizeModelInput(other, { duration: -1 }).duration).toBe(MODEL_CATALOG[other]!.durations![0])
    expect(validateModelInput(other, { duration: -1 })?.field).toBe("duration")
  })
})
