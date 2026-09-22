import type { WorkflowNode, SubWorkflowData } from "@/types/nodes"
import { wordTimingsPreflight } from "./add-captions-preflight"
import {
  SUB_WORKFLOW_MAX_DEPTH,
  loadSubWorkflowRouteGraph,
  subWorkflowRouteKey,
  type SubWorkflowRouteGraph,
} from "./sub-workflow-route-graph"

/**
 * The word-timings refusal, extended THROUGH sub-workflow nodes.
 *
 * `wordTimingsPreflight` only sees the graph it is handed, so a
 * transcribe(whisper) → add-captions chain living inside a referenced workflow
 * passed every run gate and was refused mid-run — after the parent's upstream
 * nodes had already executed and billed. The contract is "the run does not
 * start", so the nested graphs have to be inspected UP FRONT.
 *
 * Loads each referenced route through the same loader the executor runs on
 * (`loadSubWorkflowRouteGraph`), so the check sees exactly the graph that will
 * execute, and carries the executor's own depth limit and workflow+route cycle
 * guard so a nested-nested chain is covered and a self-reference cannot loop.
 *
 * A reference that cannot be LOADED (missing workflow, missing route, an
 * unconfigured node), a depth overflow or a cycle is IGNORED here — the run
 * surfaces each of those itself, with its own message; a preflight that refused
 * them would be answering a question it was not asked.
 *
 * Returns the blocking message (the same `Node "<label>": …` shape
 * `wordTimingsPreflight` produces), or null when the run may proceed.
 */
export async function nestedWordTimingsPreflight(
  executing: ReadonlyArray<WorkflowNode>,
  opts: {
    depth?: number
    routeKeys?: ReadonlySet<string>
    load?: (data: SubWorkflowData) => Promise<SubWorkflowRouteGraph>
  } = {},
): Promise<string | null> {
  const depth = opts.depth ?? 0
  const routeKeys = opts.routeKeys ?? new Set<string>()
  const load = opts.load ?? loadSubWorkflowRouteGraph
  if (depth >= SUB_WORKFLOW_MAX_DEPTH) return null

  for (const node of executing) {
    if (node.type !== "sub-workflow") continue
    const data = node.data as SubWorkflowData
    if ((data as { skipped?: boolean }).skipped === true) continue
    if (!data.referencedWorkflowId || !data.routeSnapshot) continue
    const routeKey = subWorkflowRouteKey(data)
    if (routeKeys.has(routeKey)) continue

    let graph: SubWorkflowRouteGraph
    try {
      graph = await load(data)
    } catch {
      continue
    }

    const blocked = wordTimingsPreflight(graph.nodes, graph.edges)
    if (blocked) return blocked

    const nested = await nestedWordTimingsPreflight(graph.nodes, {
      depth: depth + 1,
      routeKeys: new Set([...routeKeys, routeKey]),
      load,
    })
    if (nested) return nested
  }
  return null
}
