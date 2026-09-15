/**
 * Welcome credits opt-in — the creation block for an account that was granted
 * through the Chrome extension and still owes its email consent.
 *
 * Three things, each its own test:
 *  - The block is SERVER-SIDE: with the offer on and the mark set, any
 *    non-extension caller gets `403 consent_required` before the storage and
 *    credit checks run (nothing is reserved, nothing priced).
 *  - The extension itself is exempt — decided by the browser-set Origin
 *    scheme, never by a header the page could set.
 *  - With the offer OFF the guard does not even ask for the column: the
 *    profile select is the pre-426 one, so a dev deploy running ahead of the
 *    migration is byte-identical to today.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses, chains } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const chains: Array<{ table: string; select: ReturnType<typeof vi.fn> }> = []
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
    chains.push({ table, select: chain.select as ReturnType<typeof vi.fn> })
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  return { mockFrom, tableResponses, chains }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
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
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
  return { ...actual, deploymentPayerActive: () => false, deploymentPayerId: () => null, allowanceEnforcementActive: () => false }
})

import { creditGuardImpl, CONSENT_REQUIRED_CODE } from "../credit-guard-impl.js"
import { invalidateWelcomeOfferConfigCache } from "../welcome-offer-config.js"

const USER = "user-ext-1"

function profileRow(consentPending: boolean): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "free",
      subscription_tier: null,
      lifetime_topup_credits: 0,
      subscription_credits: 1500,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
      welcome_consent_pending: consentPending,
    },
    error: null,
  })
}

function offer(enabled: boolean | null): void {
  tableResponses.set("app_settings", {
    data: enabled === null ? null : { key: "welcome_offer_enabled", value: enabled },
    error: null,
  })
}

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  return {
    sent,
    reply: {
      status(code: number) {
        return { send: (body: unknown) => { sent.push({ status: code, body }) } }
      },
    },
  }
}

const makeReq = (headers: Record<string, string>) => ({
  userId: USER,
  url: "/v1/generate-image",
  headers,
  body: {},
})

/** The profile select the guard issued (the last `profiles` chain). */
function profileSelect(): string {
  const last = [...chains].reverse().find((c) => c.table === "profiles")
  return String(last?.select.mock.calls[0]?.[0] ?? "")
}

beforeEach(() => {
  tableResponses.clear()
  chains.length = 0
  mockFrom.mockClear()
  invalidateWelcomeOfferConfigCache()
  tableResponses.set("model_pricing", { data: { credit_cost: 10, is_enabled: true, tier_restriction: null }, error: null })
})

describe("credit guard — consent_required (welcome offer ON)", () => {
  it("blocks a web app caller whose consent is still owed, before any pricing or reservation", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(makeReq({ origin: "https://studio.nodaro.ai" }) as never, reply as never)
    expect(sent).toHaveLength(1)
    expect(sent[0].status).toBe(403)
    expect((sent[0].body as { error: { code: string } }).error.code).toBe(CONSENT_REQUIRED_CODE)
    expect(profileSelect()).toContain("welcome_consent_pending")
  })

  it("blocks an API / no-Origin caller the same way", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(makeReq({}) as never, reply as never)
    expect(sent[0]?.status).toBe(403)
  })

  it("lets the extension through — the browser-set Origin scheme, not a header, decides", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(
      makeReq({ origin: "chrome-extension://abcdefghijklmnop" }) as never,
      reply as never,
    )
    // Nothing sent at all: the guard passed and left the route to run.
    expect(sent).toEqual([])
  })

  it("an API client with no Origin claiming the extension via the client header is still blocked", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(
      makeReq({ "x-nodaro-client": "extension/ext.nodaro.ai@0.2.0" }) as never,
      reply as never,
    )
    expect(sent[0]?.status).toBe(403)
  })

  it("a web page claiming to be the extension via the client header is still blocked", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(
      makeReq({ origin: "https://evil.example", "x-nodaro-client": "extension/ext.nodaro.ai@0.2.0" }) as never,
      reply as never,
    )
    expect(sent[0]?.status).toBe(403)
  })

  it("blocks the orchestrator's internal hop too (never an extension origin)", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")({ ...makeReq({}), isInternalCall: true } as never, reply as never)
    expect(sent[0]?.status).toBe(403)
  })

  it("lets a check-only route (cost estimate) through — it reserves nothing", async () => {
    offer(true)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2", { checkOnly: true })(
      makeReq({ origin: "https://app.nodaro.ai" }) as never,
      reply as never,
    )
    expect(sent.find((s) => s.status === 403)).toBeUndefined()
  })

  it("does not block an account that consented (mark cleared)", async () => {
    offer(true)
    profileRow(false)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(makeReq({ origin: "https://app.nodaro.ai" }) as never, reply as never)
    expect(sent.find((s) => s.status === 403)).toBeUndefined()
  })
})

describe("credit guard — welcome offer OFF", () => {
  it("never asks for the column and never blocks, even with the mark set", async () => {
    offer(null)
    profileRow(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "gpt-image-2")(makeReq({ origin: "https://app.nodaro.ai" }) as never, reply as never)
    expect(sent.find((s) => s.status === 403)).toBeUndefined()
    expect(profileSelect()).not.toContain("welcome_consent_pending")
  })
})
