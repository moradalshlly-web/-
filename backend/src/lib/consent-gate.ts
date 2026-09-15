import type { FastifyReply, FastifyRequest } from "fastify"
import { hasCredits } from "./config.js"

/**
 * Core shim for the welcome-credits consent block on run-starting routes.
 *
 * Same shape as `middleware/credit-guard.ts`: community/business builds
 * short-circuit (no consent concept without credits); cloud delegates to
 * `ee/lib/welcome-consent-gate.ts` through one memoised dynamic import.
 * Returns true when a 403 was sent and the route must return.
 */
let implPromise: Promise<typeof import("../ee/lib/welcome-consent-gate.js")> | null = null

export async function refuseIfConsentPending(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!hasCredits()) return false
  const impl = await (implPromise ??= import("../ee/lib/welcome-consent-gate.js"))
  return impl.refuseIfConsentPending(req, reply)
}
