/**
 * The `**Credit cost:**` line of a node's generated skill header.
 *
 * It used to print the FRONTEND `NODE_DEFINITIONS.creditCost` — a hand-typed
 * number nothing at runtime reads, and so a number no reprice ever touched.
 * After the ×10 re-denomination it told every `get_node_skill` caller that
 * add-captions costs 2 (it is 30, or 50 for a kinetic render) and transcribe 3,
 * across all ~198 generated skills. That field is no longer reachable from the
 * generator at all — it is not carried on `NodeDef` any more — so the header
 * cannot drift back onto it.
 *
 * What it prints instead is exactly what `GET /v1/nodes` serves on a credited
 * deployment: the `NODE_REGISTRY` figure a node declares, or the price table's
 * base for the node type when it declares none (the same fallback
 * `getEnrichedRegistry()` applies). Plus, always, the pointer to the live
 * price — even a declared figure is a static summary of `model_pricing`, which
 * an admin edits at runtime, and most nodes price per model and settings.
 *
 * `NODE_REGISTRY` + `STATIC_CREDIT_COSTS` deliberately, never
 * `getEnrichedRegistry()` itself: the enriched one reads `hasCredits()`, which
 * would make the generated markdown depend on the EDITION env var and hand
 * `gen:skills:check` a drift nobody could explain.
 */
import { STATIC_CREDIT_COSTS } from "../../../src/ee/billing/credits.js"
import { NODE_REGISTRY } from "../../../src/lib/node-registry.js"

/** node type → the figure `/v1/nodes` advertises for it, where there is one. */
const NODE_CREDIT_COSTS: ReadonlyMap<string, number | string> = new Map(
  NODE_REGISTRY.flatMap((d) => {
    const cost = d.creditCost ?? STATIC_CREDIT_COSTS[d.type]
    return cost === undefined || typeof cost === "boolean"
      ? []
      : [[d.type, cost] as [string, number | string]]
  }),
)

const LIVE_PRICE =
  "the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`)"

export function renderCreditCostLine(nodeType: string): string {
  const cost = NODE_CREDIT_COSTS.get(nodeType)
  if (cost === undefined) {
    // Input, parameter, trigger and layout nodes run no job at all; anything
    // else that lands here is priced by whatever registers it at runtime.
    return `**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise ${LIVE_PRICE}.`
  }
  return `**Credit cost:** \`${cost}\` per \`GET /v1/nodes\` — ${LIVE_PRICE}.`
}
