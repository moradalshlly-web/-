import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The consent block at THE funnel: `CreditsService.reserveCredits` is where
 * every spend — route guard, the orchestrator's worker-queued nodes,
 * pipelines, publish workers — reserves, so an account that still owes its
 * email consent cannot spend anywhere. Pinned:
 *  - offer ON + mark set: the reservation throws before any RPC, with the
 *    same message the guard's 403 carries.
 *  - `consentPendingAllowed` (the guard's extension exemption) lets it through.
 *  - offer OFF: the column is never asked for (pre-426 select, byte for byte).
 * (A deployment payer's row is never consent-gated — `dep` short-circuits the
 * flag read — but that path drags the whole allowance lane through the mocks
 * and is pinned by the guard test instead.)
 */

const { mockFrom, mockRpc, tableResponses, selects } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const selects: Array<{ table: string; columns: string }> = []
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {
      select: vi.fn().mockImplementation((columns: string) => {
        selects.push({ table, columns })
        return chain
      }),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  const mockRpc = vi.fn().mockResolvedValue({ data: "usage-log-1", error: null })
  return { mockFrom, mockRpc, tableResponses, selects }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import { invalidateWelcomeOfferConfigCache } from "../../lib/welcome-offer-config.js"
import { ConsentRequiredError, CONSENT_REQUIRED_MESSAGE } from "../../lib/consent-required.js"

function offer(enabled: boolean | null): void {
  tableResponses.set("app_settings", {
    data: enabled === null ? null : { key: "welcome_offer_enabled", value: enabled },
    error: null,
  })
}

function profile(consentPending: boolean): void {
  tableResponses.set("profiles", {
    data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, welcome_consent_pending: consentPending },
    error: null,
  })
}

/** The profiles select the reservation issued. */
function profileColumns(): string {
  return selects.find((s) => s.table === "profiles")?.columns ?? ""
}

beforeEach(() => {
  vi.clearAllMocks()
  tableResponses.clear()
  selects.length = 0
  invalidateModelPricingCache()
  invalidateWelcomeOfferConfigCache()
  tableResponses.set("model_pricing", { data: { credit_cost: 5, is_enabled: true, tier_restriction: null }, error: null })
  mockRpc.mockResolvedValue({ data: "usage-log-1", error: null })
})

describe("reserveCredits — consent block (welcome offer ON)", () => {
  it("refuses an account that still owes consent, before any RPC, with the guard's message", async () => {
    offer(true)
    profile(true)
    const attempt = CreditsService.reserveCredits("user-1", "job-1", "gpt-image-2", 0, 0, {})
    await expect(attempt).rejects.toBeInstanceOf(ConsentRequiredError)
    await expect(attempt).rejects.toThrow(CONSENT_REQUIRED_MESSAGE)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(profileColumns()).toContain("welcome_consent_pending")
  })

  it("the guard's extension exemption lets the reservation through", async () => {
    offer(true)
    profile(true)
    const result = await CreditsService.reserveCredits("user-1", "job-1", "gpt-image-2", 0, 0, { consentPendingAllowed: true })
    expect(result.usageLogId).toBe("usage-log-1")
    expect(mockRpc).toHaveBeenCalled()
  })

  it("an account that consented (mark cleared) reserves normally", async () => {
    offer(true)
    profile(false)
    const result = await CreditsService.reserveCredits("user-1", "job-1", "gpt-image-2", 0, 0, {})
    expect(result.usageLogId).toBe("usage-log-1")
  })

})

describe("reserveCredits — welcome offer OFF", () => {
  it("never asks for the column and never refuses, even with the mark set", async () => {
    offer(null)
    profile(true)
    const result = await CreditsService.reserveCredits("user-1", "job-1", "gpt-image-2", 0, 0, {})
    expect(result.usageLogId).toBe("usage-log-1")
    expect(profileColumns()).toBe("tier, subscription_tier, lifetime_topup_credits")
  })
})
