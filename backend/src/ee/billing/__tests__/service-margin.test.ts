import { describe, it, expect } from "vitest"
import {
  applyMarkupPercent,
  applyServiceMarkup,
  effectiveMarkupPercent,
  serviceMarginPrefixMatches,
} from "../service-margin.js"

const base = (global_: number, margins: Record<string, number>) => ({
  cost_markup_percent: global_,
  service_margin_percent: margins,
})

describe("serviceMarginPrefixMatches", () => {
  it("matches exact identifiers and composite continuations only", () => {
    expect(serviceMarginPrefixMatches("svc", "svc")).toBe(true)
    expect(serviceMarginPrefixMatches("svc:10s", "svc")).toBe(true)
    expect(serviceMarginPrefixMatches("svc:pro:10s", "svc")).toBe(true)
    // A prefix must end on the : boundary — never a plain string prefix.
    expect(serviceMarginPrefixMatches("svc-other", "svc")).toBe(false)
    expect(serviceMarginPrefixMatches("svcx", "svc")).toBe(false)
    expect(serviceMarginPrefixMatches("sv", "svc")).toBe(false)
  })
})

describe("effectiveMarkupPercent", () => {
  it("falls back to the global markup when no service margin matches", () => {
    expect(effectiveMarkupPercent(base(25, {}), "nano-banana")).toBe(25)
    expect(effectiveMarkupPercent(base(0, { svc: 30 }), "nano-banana")).toBe(0)
  })

  it("uses the service margin for matching identifiers", () => {
    const s = base(25, { svc: 40 })
    expect(effectiveMarkupPercent(s, "svc")).toBe(40)
    expect(effectiveMarkupPercent(s, "svc:10s")).toBe(40)
  })

  it("overrides rather than stacks — the configured number IS the margin", () => {
    // Global 25% + service 10%: the service pays 10%, not 37.5%.
    expect(effectiveMarkupPercent(base(25, { svc: 10 }), "svc")).toBe(10)
  })

  it("a service margin of 0 is a real override, not a fall-through", () => {
    // Configuring 0 for a service exempts it from the global markup.
    expect(effectiveMarkupPercent(base(25, { svc: 0 }), "svc:fast")).toBe(0)
  })

  it("the longest matching prefix wins", () => {
    const s = base(0, { svc: 20, "svc:pro": 50 })
    expect(effectiveMarkupPercent(s, "svc:fast")).toBe(20)
    expect(effectiveMarkupPercent(s, "svc:pro")).toBe(50)
    expect(effectiveMarkupPercent(s, "svc:pro:10s")).toBe(50)
  })

  it("never bleeds a margin onto lookalike identifiers", () => {
    const s = base(15, { svc: 40 })
    expect(effectiveMarkupPercent(s, "svc-turbo")).toBe(15)
    expect(effectiveMarkupPercent(s, "svcx:10s")).toBe(15)
  })
})

describe("applyMarkupPercent — integer-domain rounding", () => {
  // Each of these products is EXACTLY an integer, but `base * (1 + pct/100)`
  // lands a hair ABOVE it in IEEE-754, so the old float `Math.ceil` over-charged
  // a whole credit. The integer-domain `ceil(base * (100 + pct) / 100)` returns
  // the true value. Every case below would have failed the float formula.
  it.each([
    [720, 10, 792], // the exact edit-plan probe over-charge (was 793)
    [360, 10, 396], // 360 * 1.1 === 396.00000000000006 in float
    [100, 10, 110], // 100 * 1.1 === 110.00000000000001
    [50, 10, 55], //  50 * 1.1 === 55.00000000000001
  ])("float-trap base=%i pct=%i%% → %i (not %i+1)", (base_, pct, expected) => {
    // Guard: prove the naive float formula really would over-charge here.
    expect(Math.ceil(base_ * (1 + pct / 100))).toBe(expected + 1)
    expect(applyMarkupPercent(base_, pct)).toBe(expected)
  })

  it("still rounds genuinely-fractional products up", () => {
    expect(applyMarkupPercent(7, 15)).toBe(9) // 7 * 1.15 = 8.05 → 9
    expect(applyMarkupPercent(3, 33)).toBe(4) // 3 * 1.33 = 3.99 → 4
  })

  it("is exact when the product is a clean integer", () => {
    expect(applyMarkupPercent(1000, 10)).toBe(1100)
    expect(applyMarkupPercent(4, 25)).toBe(5)
    expect(applyMarkupPercent(10, 20)).toBe(12)
  })

  it("no-ops for zero/negative percent and non-positive base", () => {
    expect(applyMarkupPercent(720, 0)).toBe(720)
    expect(applyMarkupPercent(720, -5)).toBe(720) // admin-validated ≥0, defensive
    expect(applyMarkupPercent(0, 10)).toBe(0)
    expect(applyMarkupPercent(-5, 10)).toBe(-5)
  })
})

describe("applyServiceMarkup routes through applyMarkupPercent", () => {
  it("uses the integer-domain formula for the resolved percent (reserve == settlement)", () => {
    // Global markup path and per-service path must both give the fixed value,
    // structurally identical to applyMarkupPercent — the guarantee that a
    // reserve can never round a credit apart from the actual that trues it up.
    expect(applyServiceMarkup(720, base(10, {}), "any-model")).toBe(792)
    expect(applyServiceMarkup(720, base(10, {}), "any-model")).toBe(applyMarkupPercent(720, 10))
    expect(applyServiceMarkup(360, base(25, { "svc": 10 }), "svc:pro")).toBe(
      applyMarkupPercent(360, 10),
    )
  })
})
