import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const h = vi.hoisted(() => ({
  offer: {
    mode: null as "offer" | "consent-pending" | null,
    popupDue: false,
    credits: "1,500",
    claim: vi.fn(),
    markSeen: vi.fn(),
  },
  pathname: "/projects",
}))

vi.mock("../use-welcome-offer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-welcome-offer")>()
  return { ...actual, useWelcomeOffer: () => h.offer }
})
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: h.pathname }) }))

import { WelcomeOfferPopup } from "../welcome-offer-popup"
import { useWelcomeOfferStore } from "../welcome-offer-store"
import { CONSENT_REQUIRED_EVENT } from "@/lib/consent-required-event"

beforeEach(() => {
  vi.clearAllMocks()
  h.offer.mode = null
  h.offer.popupDue = false
  h.pathname = "/projects"
  useWelcomeOfferStore.setState({ claimedCredits: null, consentAskVersion: 0 })
})

describe("WelcomeOfferPopup", () => {
  it("renders nothing when the offer does not apply", () => {
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens once on the home screen while the popup is due", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("1,500 free credits are waiting for you")).toBeInTheDocument()
  })

  it("stays closed away from the home screen", () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.pathname = "/gallery"
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("stays closed once the popup was already seen (the banner remains)", () => {
    h.offer.mode = "offer"
    h.offer.popupDue = false
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("'Maybe later' closes and marks the popup as seen — it never returns", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: "Maybe later" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.markSeen).toHaveBeenCalledTimes(1)
    expect(h.offer.claim).not.toHaveBeenCalled()
  })

  it("the × closes and marks the popup as seen", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(h.offer.markSeen).toHaveBeenCalledTimes(1))
  })

  it("the CTA claims, closes, and records the credits for the confirmation strip", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.offer.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: /add 1,500 credits/i }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(h.offer.claim).toHaveBeenCalledTimes(1)
    expect(h.offer.markSeen).not.toHaveBeenCalled()
    expect(useWelcomeOfferStore.getState().claimedCredits).toBe(1500)
  })

  it("a failed claim keeps the popup up with an error line", async () => {
    h.offer.mode = "offer"
    h.offer.popupDue = true
    h.offer.claim.mockRejectedValue(new Error("boom"))
    render(<WelcomeOfferPopup />)
    fireEvent.click(await screen.findByRole("button", { name: /add 1,500 credits/i }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("opens with the consent ask when the server refuses a creation, on any page", async () => {
    h.offer.mode = "consent-pending"
    h.pathname = "/workflows/abc"
    render(<WelcomeOfferPopup />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent(CONSENT_REQUIRED_EVENT))
    })
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Your 1,500 credits are active")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Maybe later" })).not.toBeInTheDocument()
  })
})
