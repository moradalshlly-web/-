import { hasCredits } from "./config.js"

/**
 * Base (pre-markup) credit cost of a priced identifier — the admin-editable
 * `model_pricing` row, else the static table — for a core route that settles
 * a count-based reservation (`commitJobCredits(..., baseActual, true)`).
 * Core-safe: `ee/` is reached by dynamic import, exactly like the commit /
 * refund helpers in credits-job-lifecycle.ts. 0 when credits are off.
 */
export async function baseCreditCostFor(modelIdentifier: string): Promise<number> {
  if (!hasCredits()) return 0
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  return (await getModelCreditBaseCost(modelIdentifier)).creditCost
}
