import { beforeEach, describe, expect, it, vi } from "vitest"
const h = vi.hoisted(() => ({ authorize: vi.fn(), order: [] as string[] }))
vi.mock("../../billing/external-wallet.js", () => ({ externalWalletActive: () => true, authorizeExternalReservation: h.authorize }))
import { reservePipelineCredits } from "../credits.js"
beforeEach(() => { vi.clearAllMocks(); h.order.length = 0; h.authorize.mockImplementation(async () => { h.order.push("authorize") }) })

function database(saved: boolean) {
  const rpc = vi.fn(async (name: string) => ({ data: name === "reserve_credits" ? "usage-1" : null, error: null }))
  const query = {
    update: vi.fn(() => query), eq: vi.fn(() => query), select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => { h.order.push("persist"); return { data: saved ? { id: "pipeline-1" } : null, error: null } }),
  }
  return { rpc, from: vi.fn(() => query) }
}
describe("pipeline shared-wallet recovery link", () => {
  it("persists the owned pipeline pointer before external authorization", async () => {
    const db = database(true)
    const result = await reservePipelineCredits({ supabase: db as never, userId: "user-1", pipelineId: "pipeline-1", credits: 30,
      billingContext: { payer: "deployment", userId: "user-1", payerId: "payer-1", entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "business" } } })
    expect(result).toEqual({ ok: true, usageLogId: "usage-1" })
    expect(h.order).toEqual(["persist", "authorize"])
    expect(db.from).toHaveBeenCalledOnce()
  })
  it("refunds locally and never authorizes when the recovery pointer cannot be saved", async () => {
    const db = database(false)
    const result = await reservePipelineCredits({ supabase: db as never, userId: "user-1", pipelineId: "pipeline-1", credits: 30 })
    expect(result.ok).toBe(false)
    expect(h.authorize).not.toHaveBeenCalled()
    expect(db.rpc).toHaveBeenCalledWith("refund_credits", { p_usage_log_id: "usage-1" })
  })
})
