import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUserById: vi.fn(), active: vi.fn(() => true), enforced: vi.fn(() => false) }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, auth: { admin: { getUserById: mocks.getUserById } } } }))
vi.mock("../../../lib/deployment-payer.js", () => ({ deploymentPayerActive: mocks.active, allowanceEnforcementActive: mocks.enforced, deploymentPayerId: () => "00000000-0000-4000-8000-000000000003" }))
import { authorizeExternalReservation, deliverExternalWalletSettlements, externalWalletBalance, validateExternalWallet } from "../external-wallet.js"
const id = "00000000-0000-4000-8000-000000000001"
const user = "00000000-0000-4000-8000-000000000002"
const row = { usage_log_id: id, requester_id: user, job_id: null, provider: "sai", sso_subject: "trusted",
  model_identifier: "test", reserved_credits: 20, authorized_at: null, actual_credits: null, attempts: 0 }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.example.test")
  vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", "test-only")
  vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "sai")
  mocks.active.mockReturnValue(true); mocks.enforced.mockReturnValue(false)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ contract: 1, unit: "nodaro_credit", operation_id: id, decision: "allow", reserved_credits: 20 }))))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe("durable wallet authorization", () => {
  it("does nothing when disabled", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", ""); vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", ""); vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "")
    await authorizeExternalReservation(id, user)
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it("rejects two simultaneously enforced customer budgets", () => {
    mocks.enforced.mockReturnValue(true)
    expect(() => validateExternalWallet()).toThrow(/allowances=off/)
  })
  it("persists intent before network access and approval before returning", async () => {
    mocks.rpc.mockImplementation(async name => {
      if (name === "prepare_external_wallet") { expect(fetch).not.toHaveBeenCalled(); return { data: row, error: null } }
      expect(fetch).toHaveBeenCalledOnce(); return { data: true, error: null }
    })
    await authorizeExternalReservation(id, user)
    expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(["prepare_external_wallet", "authorize_external_wallet"])
  })
  it("reuses a persisted approval without another reserve", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, authorized_at: new Date().toISOString() }, error: null })
    await authorizeExternalReservation(id, user)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("refuses dispatch if cancellation won before authorization acknowledgement", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: false, error: null })
    await expect(authorizeExternalReservation(id, user)).rejects.toThrow()
    expect(mocks.rpc.mock.calls[2]![0]).toBe("abort_external_wallet")
  })
  it("recovers a lost approval reply without cancelling an authorized operation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: null, error: { message: "lost reply" } }).mockResolvedValueOnce({ data: true, error: null })
    await expect(authorizeExternalReservation(id, user)).resolves.toBeUndefined()
  })
  it("missing trusted identity stops network dispatch and refunds the local hold", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "identity missing" } }).mockResolvedValueOnce({ data: false, error: null })
    await expect(authorizeExternalReservation(id, user)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith("abort_external_wallet", { p_usage_log_id: id })
  })
  it("ignores user-editable identity metadata", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { app_metadata: {}, user_metadata: { sso: "sai", sso_subject: "forged" } } }, error: null })
    expect(await externalWalletBalance(user)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps settlement pending after a lost response and reuses the terminal key on retry", async () => {
    const writes: Record<string, unknown>[] = []
    const terminal = { ...row, actual_credits: 7, authorized_at: new Date().toISOString() }
    mocks.from.mockImplementation(() => {
      let writing = false
      const chain: Record<string, unknown> = {}
      for (const name of ["select", "is", "not", "eq", "lte", "order", "limit"]) chain[name] = () => chain
      chain.update = (value: Record<string, unknown>) => { writing = true; writes.push(value); return chain }
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ data: writing ? null : [terminal], error: null }).then(resolve, reject)
      return chain
    })
    vi.mocked(fetch).mockRejectedValueOnce(new Error("response lost"))
    await deliverExternalWalletSettlements(id)
    expect(writes).toContainEqual(expect.objectContaining({ attempts: 1 }))
    expect(writes.some(w => "delivered_at" in w)).toBe(false)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ contract: 1, unit: "nodaro_credit", operation_id: id, settled: true, actual_credits: 7 })))
    await deliverExternalWalletSettlements(id)
    expect(writes.some(w => "delivered_at" in w)).toBe(true)
    expect(vi.mocked(fetch).mock.calls.map(call => (call[1]?.headers as Record<string, string>)["Idempotency-Key"]))
      .toEqual([`${id}:settle`, `${id}:settle`])
  })
})
