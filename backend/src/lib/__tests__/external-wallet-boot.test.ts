import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const h = vi.hoisted(() => ({ credits: vi.fn(() => true), payer: vi.fn(async () => ({ ok: true })), validate: vi.fn() }))
vi.mock("../config.js", () => ({ hasCredits: h.credits }))
vi.mock("../deployment-payer.js", () => ({ configureDeploymentPayer: h.payer }))
vi.mock("../../ee/billing/external-wallet.js", () => ({ validateExternalWallet: h.validate }))
import { initializeExternalWallet } from "../external-wallet.js"
beforeEach(() => { vi.clearAllMocks(); h.credits.mockReturnValue(true); h.payer.mockResolvedValue({ ok: true }) })
afterEach(() => vi.unstubAllEnvs())
describe("external wallet worker boot", () => {
  it("leaves unconfigured workers untouched", async () => {
    for (const key of ["DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) vi.stubEnv(key, "")
    await initializeExternalWallet(true)
    expect(h.payer).not.toHaveBeenCalled(); expect(h.validate).not.toHaveBeenCalled()
  })
  it("initializes the worker payer before validating wallet mode", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.test")
    h.validate.mockImplementationOnce(() => { expect(h.payer).toHaveBeenCalledOnce() })
    await initializeExternalWallet(true)
    expect(h.validate).toHaveBeenCalledOnce()
  })
  it("does not run a second payer initialization on the API", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.test")
    await initializeExternalWallet()
    expect(h.payer).not.toHaveBeenCalled(); expect(h.validate).toHaveBeenCalledOnce()
  })
  it("refuses unsupported editions", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.test"); h.credits.mockReturnValue(false)
    await expect(initializeExternalWallet(true)).rejects.toThrow(/cloud/)
  })
})
