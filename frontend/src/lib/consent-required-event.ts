/**
 * The server refused a creation because the account still owes its
 * marketing-email consent (`403 consent_required` — an account granted its
 * free credits through the Chrome extension, which has no consent UI).
 *
 * Every REST call funnels through `throwApiError`, which dispatches this
 * event before throwing `ConsentRequiredError`; the welcome-offer popup
 * (Cloud-only, mounted by the dashboard layout) listens and opens with the
 * consent ask. Core dispatches, ee listens — the ee boundary stays intact.
 */
export const CONSENT_REQUIRED_EVENT = "nodaro:consent-required"

export function dispatchConsentRequired(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CONSENT_REQUIRED_EVENT))
}
