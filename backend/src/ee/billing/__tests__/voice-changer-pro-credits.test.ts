import { describe, it, expect, beforeEach, vi } from "vitest"

// No model_pricing rows → every identifier resolves through STATIC_CREDIT_COSTS.
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

import {
  computeVoiceChangerProPricing,
  priceVoiceChangerPro,
  stsSlotCredits,
  respeakSlotCredits,
  voiceChangerProFloor,
  VOICE_CHANGER_PRO_MINUTE_MODEL,
  VOICE_CHANGER_PRO_RESPEAK_MODEL,
} from "../voice-changer-pro-credits.js"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, invalidateModelPricingCache } from "../credits.js"

const UNIT = 40   // credits per started minute of stem audio (STATIC seed)
const PER_1K = 30 // credits per started 1K re-spoken chars (migration 427 / plugin seed)

beforeEach(() => {
  invalidateModelPricingCache()
})

describe("golden units (credits.ts seed)", () => {
  it("the per-minute unit is the voice-changer-pro static seed", () => {
    expect(STATIC_CREDIT_COSTS[VOICE_CHANGER_PRO_MINUTE_MODEL]).toBe(UNIT)
  })
})

describe("voiceChangerProFloor", () => {
  it("is six billable seconds at the unit (40/min → 4), never below 1", () => {
    expect(voiceChangerProFloor(40)).toBe(4)
    expect(voiceChangerProFloor(60)).toBe(6)
    expect(voiceChangerProFloor(1)).toBe(1)
    expect(voiceChangerProFloor(0)).toBe(1)
  })
})

describe("stsSlotCredits — per started minute of stem audio", () => {
  const floor = voiceChangerProFloor(UNIT)
  it.each([
    [26.76, 18],   // the 27 s clip that started this: ceil(40 × 26.76 / 60) = 18
    [60, 40],      // exactly one minute = one unit
    [61, 41],      // prorated per second, rounded up
    [180.9, 121],  // three minutes
    [3, 4],        // below the floor → floor
    [0.5, 4],
  ])("%s s → %s base credits", (sec, credits) => {
    expect(stsSlotCredits(UNIT, floor, sec)).toBe(credits)
  })
  it("an UNKNOWN stem length (blind caller) reserves one minute", () => {
    expect(stsSlotCredits(UNIT, floor, null)).toBe(UNIT)
    expect(stsSlotCredits(UNIT, floor, undefined)).toBe(UNIT)
    expect(stsSlotCredits(UNIT, floor, 0)).toBe(UNIT)
    expect(stsSlotCredits(UNIT, floor, Number.NaN)).toBe(UNIT)
  })
})

describe("respeakSlotCredits — per started 1K chars", () => {
  const floor = voiceChangerProFloor(UNIT)
  it.each([
    [340, 30],
    [1000, 30],
    [1001, 60],
    [18280, 570],
  ])("%s chars → %s base credits", (chars, credits) => {
    expect(respeakSlotCredits(PER_1K, floor, chars)).toBe(credits)
  })
  it("an UNKNOWN transcript reserves one 1K bucket", () => {
    expect(respeakSlotCredits(PER_1K, floor, null)).toBe(PER_1K)
    expect(respeakSlotCredits(PER_1K, floor, 0)).toBe(PER_1K)
  })
  it("never drops below the floor when the per-1K unit is tuned tiny", () => {
    expect(respeakSlotCredits(1, floor, 10)).toBe(floor)
  })
})

describe("priceVoiceChangerPro — the reservation / commit total", () => {
  it("sums every slot and echoes the per-slot breakdown", () => {
    const p = priceVoiceChangerPro(UNIT, PER_1K, { stsSlotSeconds: [26.76, 60], respeakChars: [1500] })
    expect(p.unitPerMinute).toBe(UNIT)
    expect(p.respeakPer1K).toBe(PER_1K)
    expect(p.floor).toBe(4)
    expect(p.stsCredits).toEqual([18, 40])
    expect(p.respeakCredits).toEqual([60])
    expect(p.reserveBase).toBe(18 + 40 + 60)
  })
  it("an empty mapping still reserves the floor (a keep-only recast is never free)", () => {
    expect(priceVoiceChangerPro(UNIT, PER_1K, { stsSlotSeconds: [], respeakChars: [] }).reserveBase).toBe(4)
  })
  it("the blind one-speaker recast reserves one minute", () => {
    expect(priceVoiceChangerPro(UNIT, PER_1K, { stsSlotSeconds: [null], respeakChars: [] }).reserveBase).toBe(UNIT)
  })
})

describe("computeVoiceChangerProPricing — reads both units through the credit layer", () => {
  it("prices from the seeds when no model_pricing rows exist", async () => {
    // The respeak identifier is seeded by the plugin (staticCreditCosts) and
    // rowed by migration 427; in this unit test it is absent from the app's
    // STATIC map, so the credit layer must refuse rather than price it free.
    if (STATIC_CREDIT_COSTS[VOICE_CHANGER_PRO_RESPEAK_MODEL] === undefined) {
      await expect(computeVoiceChangerProPricing({ stsSlotSeconds: [60], respeakChars: [] }))
        .rejects.toBeInstanceOf(PriceNotConfiguredError)
      return
    }
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [60], respeakChars: [] })
    expect(p.unitPerMinute).toBe(UNIT)
    expect(p.reserveBase).toBe(UNIT)
  })
})
