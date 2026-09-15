/**
 * The one refusal every spend path shares when an account still owes its
 * marketing-email consent (granted its free credits through the Chrome
 * extension, which has no consent UI). Leaf module on purpose: the billing
 * funnel, the route guard and the run route all import it, and none of them
 * may drag the others in.
 */
export const CONSENT_REQUIRED_CODE = "consent_required"

export const CONSENT_REQUIRED_MESSAGE =
  "Say yes to product updates by email to keep creating — your free credits are already in your account."

export class ConsentRequiredError extends Error {
  readonly code = CONSENT_REQUIRED_CODE
  constructor(message: string = CONSENT_REQUIRED_MESSAGE) {
    super(message)
    this.name = "ConsentRequiredError"
  }
}
