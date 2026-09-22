/**
 * The OUTPUT MINUTES an Apply EDL node's cost pill prices — the hook face of
 * `lib/apply-edl-estimate`, so the pill quotes what the run-level estimates
 * quote. One selector: O(edges), returns a primitive, safe on every store tick.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resolveApplyEdlEstimateMinutes } from "@/lib/apply-edl-estimate"

/** A pill prices running THIS node now: nothing upstream re-plans, so the
 *  persisted upstream plan is exactly what would render. Module-level so the
 *  selector sees a stable reference. */
const NO_RERUNS: ReadonlySet<string> = new Set()

export function useApplyEdlEstimateMinutes(nodeId: string): number {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return node ? resolveApplyEdlEstimateMinutes(node, s.nodes, s.edges, NO_RERUNS) : 1
  })
}
