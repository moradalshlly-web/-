import { describe, expect, it } from "vitest"
import { usageAmount } from "../usage-amount.js"
describe("usage amounts for reconciliation", () => {
  it("reports the actual charge after a partial refund", () => expect(usageAmount({ status: "committed", credits_used: 100, credits_charged: 40 })).toBe(40))
  it("reports zero for refunded reservations", () => expect(usageAmount({ status: "refunded", credits_used: 100 })).toBe(0))
  it("keeps a pending reservation distinct from a zero charge", () => expect(usageAmount({ status: "reserved", credits_used: 100, credits_charged: 0 })).toBe(100))
  it("retains legacy charges and unavailable figures", () => {
    expect(usageAmount({ status: "committed", credits_used: 20, credits_charged: null })).toBe(20)
    expect(usageAmount({ status: "committed", credits_used: null })).toBeNull()
  })
})
