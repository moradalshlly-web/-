import { create } from "zustand"

/**
 * The two bits of welcome-offer state that cross components.
 *
 * `claimedCredits` — set by whichever surface (popup or banner) completed a
 * successful claim; the banner slot then shows the one-time "credits added"
 * strip until "Done". Session-local on purpose: the design shows it once,
 * and the server already knows the account is granted.
 *
 * `consentAskVersion` — bumped when the server refuses a creation with
 * `consent_required` (an extension-granted account that has not consented);
 * the popup opens with the ask wherever the refusal happened.
 */
interface WelcomeOfferState {
  claimedCredits: number | null
  consentAskVersion: number
  setClaimed: (credits: number) => void
  dismissClaimed: () => void
  askForConsent: () => void
}

export const useWelcomeOfferStore = create<WelcomeOfferState>((set) => ({
  claimedCredits: null,
  consentAskVersion: 0,
  setClaimed: (credits) => set({ claimedCredits: credits }),
  dismissClaimed: () => set({ claimedCredits: null }),
  askForConsent: () => set((s) => ({ consentAskVersion: s.consentAskVersion + 1 })),
}))
