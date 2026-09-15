import type { FastifyReply, FastifyRequest } from "fastify"
import { isExtensionOrigin } from "../../lib/job-source.js"
import { firstHeaderValue } from "../../lib/request-helpers.js"
import { readWelcomeOfferState } from "../billing/signup-grant.js"
import { getWelcomeOfferConfig } from "./welcome-offer-config.js"
import { CONSENT_REQUIRED_CODE, CONSENT_REQUIRED_MESSAGE } from "./consent-required.js"

/**
 * The creation block for an account that still owes its email consent.
 *
 * The RULE lives in `CreditsService.reserveCredits` — every spend (route
 * guard, orchestrator, workers, pipelines) reserves there, so nothing can be
 * spent by such an account anywhere. What lives here is the EDGE: the same
 * refusal answered early, as a 403 the browser can turn into the consent ask
 * instead of a node failing mid-run.
 *
 * The one exemption is the Chrome extension, decided by the request Origin
 * SCHEME alone (`chrome-extension:` — see job-source.ts). Deliberately NOT
 * `deriveJobSource(req).source`: that derivation also honours the
 * `x-nodaro-client` header when no Origin is present, which any API client
 * can send. A web page cannot set an extension Origin, so no web app can
 * claim the exemption; a non-browser client can forge one, which is the
 * same trust level the keyless signup fallback (`isForeignOrigin`) already
 * lives with — the exemption only lets an account spend credits it was
 * legitimately granted.
 */
export function consentBlockExempt(req: FastifyRequest): boolean {
  // Optional chaining: this runs inside the guard's reservation path, where
  // route tests hand in bare request doubles without a headers bag.
  return isExtensionOrigin(firstHeaderValue(req.headers?.origin))
}

export function sendConsentRequired(reply: FastifyReply): void {
  reply.status(403).send({ error: { code: CONSENT_REQUIRED_CODE, message: CONSENT_REQUIRED_MESSAGE } })
}

/** Does this account owe its consent right now? Flag-gated and fail-open:
 *  off, a missing column (dev ahead of migration 426) or a read error all
 *  answer "no block". */
export async function consentPendingFor(userId: string): Promise<boolean> {
  try {
    const cfg = await getWelcomeOfferConfig()
    if (!cfg.enabled) return false
    return (await readWelcomeOfferState(userId))?.consentPending === true
  } catch {
    return false
  }
}

/**
 * Refuse a run-starting request for a consent-owing account. Returns true when
 * the 403 was sent (the caller returns). Deployment-payer requests are never
 * refused here: the requester holds no wallet on such an instance.
 */
export async function refuseIfConsentPending(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const userId = req.userId
  if (!userId) return false
  if (req.billingContext?.payer === "deployment") return false
  if (consentBlockExempt(req)) return false
  if (!(await consentPendingFor(userId))) return false
  sendConsentRequired(reply)
  return true
}
