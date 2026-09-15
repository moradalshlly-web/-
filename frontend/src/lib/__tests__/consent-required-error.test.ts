import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { getUserCredits, ConsentRequiredError } from "../api"
import { CONSENT_REQUIRED_EVENT } from "../consent-required-event"

/**
 * `403 consent_required` — the server refused because the account got its
 * free credits through the Chrome extension and still owes the email
 * consent. Every REST call funnels through `throwApiError`, so ONE mapping
 * covers every create button: the typed error for the caller, and the
 * window event the welcome popup listens for.
 */
describe("consent_required → ConsentRequiredError + event", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { code: "consent_required", message: "Say yes first" } }),
      text: () => Promise.resolve(""),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("throws the typed error with the server's message", async () => {
    await expect(getUserCredits("u1")).rejects.toBeInstanceOf(ConsentRequiredError)
    await expect(getUserCredits("u1")).rejects.toThrow("Say yes first")
  })

  it("dispatches the consent-required event before throwing", async () => {
    const seen = vi.fn()
    window.addEventListener(CONSENT_REQUIRED_EVENT, seen)
    try {
      await getUserCredits("u1").catch(() => {})
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(CONSENT_REQUIRED_EVENT, seen)
    }
  })
})
