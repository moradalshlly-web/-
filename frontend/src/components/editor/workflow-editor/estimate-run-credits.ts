/**
 * Estimate the credit cost of running a set of executable nodes — the single
 * source of truth for the Execute-workflow button badge, the pre-run credit
 * precheck, and the run-confirmation gate. Uses the COST multiplier (fan-out ×
 * repeat × per-output-minute units) so list-driven runs and per-minute renders
 * are priced for everything they will reserve — this number gates the run.
 *
 * The per-model cached cost is injected (`cachedCost`) rather than imported, so
 * this stays in CORE — the live-cost cache lives under `@/ee` (credits are an
 * enterprise concern) and only the already-allowlisted callers reach into it.
 */
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { NODE_CREDIT_COSTS, getCostMultiplier } from "./types"

export function estimateRunCredits(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: (modelId: string) => number | undefined,
): number {
  // The executable set is exactly what re-runs: an upstream planner inside it
  // re-plans (its canvas result is stale); one outside it keeps its result, so a
  // single-node / run-from-here render is priced on the plan that will render.
  const rerunIds = new Set(executable.map((n) => n.id))
  return executable.reduce((sum, node) => {
    const cached = cachedCost(getModelIdentifier(node, edges, allNodes))
    const cost = cached !== undefined ? cached : (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1)
    return sum + cost * getCostMultiplier(node, allNodes, edges, rerunIds)
  }, 0)
}
