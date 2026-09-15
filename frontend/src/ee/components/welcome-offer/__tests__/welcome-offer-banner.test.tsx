import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  offer: {
    mode: null as "offer" | "consent-pending" | null,
    popupDue: false,
    credits: "1,500",
    claim: vi.fn(),
    markSeen: vi.fn(),
  },
}))

vi.mock("../use-welcome-offer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-welcome-offer")>()
  return { ...actual, useWelcomeOffer: () => h.offer }
})

import { WelcomeOfferBanner } from "../welcome-offer-banner"
import { useWelcomeOfferStore } from "../welcome-offer-store"

beforeEach(() => {
  vi.clearAllMocks()
  h.offer.mode = null
  useWelcomeOfferStore.setState({ claimedCredits: null, consentAskVersion: 0 })
})

describe("WelcomeOfferBanner", () => {
  it("renders nothing when the offer does not apply", () => {
    const { container } = render(<WelcomeOfferBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it("offers the credits with the CTA and no dismiss", () => {
    h.offer.mode = "offer"
    render(<WelcomeOfferBanner />)
    expect(screen.getByText("Get 1,500 free credits")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add 1,500 credits/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /maybe later|close|done/i })).not.toBeInTheDocument()
  })

  it("claims from the CTA and swaps to the one-time 'credits added' strip", async () => {
    h.offer.mode = "offer"
    h.offer.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    render(<WelcomeOfferBanner />)
    fireEvent.click(screen.getByRole("button", { name: /add 1,500 credits/i }))
    await waitFor(() => expect(h.offer.claim).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("1,500 credits added")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByText("1,500 credits added")).not.toBeInTheDocument()
  })

  it("a withheld grant shows no 'credits added' strip (the activation banner takes over)", async () => {
    h.offer.mode = "offer"
    h.offer.claim.mockResolvedValue({ consent: "granted", grant: "withheld", credits: 1500 })
    render(<WelcomeOfferBanner />)
    fireEvent.click(screen.getByRole("button", { name: /add 1,500 credits/i }))
    await waitFor(() => expect(h.offer.claim).toHaveBeenCalledTimes(1))
    expect(useWelcomeOfferStore.getState().claimedCredits).toBeNull()
  })

  it("keeps the CTA up with an error line when the claim fails", async () => {
    h.offer.mode = "offer"
    h.offer.claim.mockRejectedValue(new Error("boom"))
    render(<WelcomeOfferBanner />)
    fireEvent.click(screen.getByRole("button", { name: /add 1,500 credits/i }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add 1,500 credits/i })).toBeEnabled()
  })

  it("shows the consent-pending copy for an extension-granted account", () => {
    h.offer.mode = "consent-pending"
    render(<WelcomeOfferBanner />)
    expect(screen.getByText("Your 1,500 credits are active")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /keep creating/i })).toBeInTheDocument()
  })
})
