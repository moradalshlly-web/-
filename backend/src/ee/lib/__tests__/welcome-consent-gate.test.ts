import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The edge of the consent block — what the run route asks before it enqueues
 * anything. `deriveJobSource` is REAL (the Origin-scheme rule is the point);
 * the flag and the profile read are doubled.
 */
const { mockConfig, mockState } = vi.hoisted(() => ({ mockConfig: vi.fn(), mockState: vi.fn() }))
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: mockConfig }))
vi.mock("@/ee/billing/signup-grant.js", () => ({ readWelcomeOfferState: mockState }))

import { consentBlockExempt, consentPendingFor, refuseIfConsentPending } from "../welcome-consent-gate.js"
import { CONSENT_REQUIRED_CODE } from "../consent-required.js"

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

const req = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
  ({ userId: "u1", headers, body: {}, ...extra }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.mockResolvedValue({ enabled: true })
  mockState.mockResolvedValue({ popupSeen: false, consentPending: true })
})

describe("consentBlockExempt", () => {
  it("only an extension-scheme Origin is exempt", () => {
    expect(consentBlockExempt(req({ origin: "chrome-extension://abc" }))).toBe(true)
    expect(consentBlockExempt(req({ origin: "moz-extension://abc" }))).toBe(true)
    expect(consentBlockExempt(req({ origin: "https://studio.nodaro.ai" }))).toBe(false)
    expect(consentBlockExempt(req({}))).toBe(false)
    expect(consentBlockExempt(req({ "x-nodaro-client": "extension/ext.nodaro.ai@0.2.0" }))).toBe(false)
  })
})

describe("consentPendingFor", () => {
  it("is false while the offer is off, without reading the profile", async () => {
    mockConfig.mockResolvedValue({ enabled: false })
    expect(await consentPendingFor("u1")).toBe(false)
    expect(mockState).not.toHaveBeenCalled()
  })

  it("fails open on a read error (pre-migration) and on a null state", async () => {
    mockState.mockResolvedValue(null)
    expect(await consentPendingFor("u1")).toBe(false)
    mockState.mockRejectedValue(new Error("column does not exist"))
    expect(await consentPendingFor("u1")).toBe(false)
  })
})

describe("refuseIfConsentPending", () => {
  it("sends the 403 for a web caller who owes consent", async () => {
    const { reply, sent } = makeReply()
    expect(await refuseIfConsentPending(req({ origin: "https://app.nodaro.ai" }), reply as never)).toBe(true)
    expect(sent[0]).toMatchObject({ status: 403, body: { error: { code: CONSENT_REQUIRED_CODE } } })
  })

  it("lets the extension, an anonymous request, a deployment-payer request and a consented account through", async () => {
    const { reply, sent } = makeReply()
    expect(await refuseIfConsentPending(req({ origin: "chrome-extension://abc" }), reply as never)).toBe(false)
    expect(await refuseIfConsentPending({ headers: {} } as never, reply as never)).toBe(false)
    expect(
      await refuseIfConsentPending(req({}, { billingContext: { payer: "deployment", payerId: "p" } }), reply as never),
    ).toBe(false)
    mockState.mockResolvedValue({ popupSeen: true, consentPending: false })
    expect(await refuseIfConsentPending(req({ origin: "https://app.nodaro.ai" }), reply as never)).toBe(false)
    expect(sent).toEqual([])
  })
})
