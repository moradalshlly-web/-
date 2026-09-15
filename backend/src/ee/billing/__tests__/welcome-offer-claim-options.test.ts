import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * How a request shapes the grant claim under the welcome offer. The Origin
 * SCHEME is the only thing that selects the extension exception — never the
 * `x-nodaro-client` header, which any API client can send.
 */
const { mockConfig } = vi.hoisted(() => ({ mockConfig: vi.fn() }))
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: mockConfig }))

import { welcomeClaimOptions } from "../welcome-offer-claim-options.js"

const req = (headers: Record<string, string>) => ({ headers, body: {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.mockResolvedValue({ enabled: true })
})

describe("welcomeClaimOptions", () => {
  it("offer OFF: no options — the pre-426 unconditional claim", async () => {
    mockConfig.mockResolvedValue({ enabled: false })
    expect(await welcomeClaimOptions(req({ origin: "https://app.nodaro.ai" }))).toEqual({})
    expect(await welcomeClaimOptions(req({ origin: "chrome-extension://abc" }))).toEqual({})
  })

  it("extension Origin scheme: grant now, owe consent", async () => {
    expect(await welcomeClaimOptions(req({ origin: "chrome-extension://abcdefghijklmnop" }))).toEqual({
      markConsentPending: true,
    })
    expect(await welcomeClaimOptions(req({ origin: "moz-extension://abc" }))).toEqual({ markConsentPending: true })
  })

  it("everything else: consent first — a web app, no Origin, and the forgeable client header alike", async () => {
    expect(await welcomeClaimOptions(req({ origin: "https://studio.nodaro.ai" }))).toEqual({ requireConsent: true })
    expect(await welcomeClaimOptions(req({}))).toEqual({ requireConsent: true })
    expect(await welcomeClaimOptions(req({ "x-nodaro-client": "extension/ext.nodaro.ai@0.2.0" }))).toEqual({
      requireConsent: true,
    })
    expect(
      await welcomeClaimOptions(req({ origin: "https://evil.example", "x-nodaro-client": "extension/x@1" })),
    ).toEqual({ requireConsent: true })
  })
})
