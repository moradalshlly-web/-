/**
 * The duration an Edit Plan node's cost pill buckets on — the hook face of
 * `lib/edit-plan-estimate`, so the pill quotes the same bucket as every
 * run-level estimate. One selector: O(edges), returns a primitive, so it is safe
 * on every store tick (a node drag fires dozens a second).
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resolveEditPlanEstimateDurationSec } from "@/lib/edit-plan-estimate"

export function useEditPlanEstimateDurationSec(nodeId: string): number | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return node ? resolveEditPlanEstimateDurationSec(node, s.nodes, s.edges) : undefined
  })
}
