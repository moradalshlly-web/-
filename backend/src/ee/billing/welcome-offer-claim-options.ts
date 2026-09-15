import type { FastifyRequest } from "fastify"
import { isExtensionOrigin } from "../../lib/job-source.js"
import { firstHeaderValue } from "../../lib/request-helpers.js"
import { getWelcomeOfferConfig } from "../lib/welcome-offer-config.js"
import type { ClaimOptions } from "./signup-grant.js"

/**
 * How the welcome-credits opt-in shapes ONE grant claim, from the request
 * that carries it. The two claim callers (the boot-time endpoint and the
 * balance-read fallback) both ask here, so they can never disagree.
 *
 * - Offer off: `{}` — today's unconditional claim, byte-identical RPC call.
 * - Extension Origin SCHEME (`chrome-extension:`, see `job-source.ts`) —
 *   the scheme alone, never the forgeable `x-nodaro-client` header: grant
 *   now, owe consent on the web. A web page cannot set that Origin; a
 *   non-browser client can, which is the same trust the keyless fallback
 *   (`isForeignOrigin`) already extends — and what it buys is today's
 *   unconditional grant, nothing more.
 * - Anything else: consent first.
 */
export async function welcomeClaimOptions(req: FastifyRequest): Promise<ClaimOptions> {
  const cfg = await getWelcomeOfferConfig()
  if (!cfg.enabled) return {}
  return isExtensionOrigin(firstHeaderValue(req.headers?.origin)) ? { markConsentPending: true } : { requireConsent: true }
}
