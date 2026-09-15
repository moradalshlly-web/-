import type { HintEdgeLike, HintGraphContext, HintNodeLike } from "@nodaro/shared"

/**
 * Parameter pickers whose `{Label}` text on the SERVER is composed from the
 * graph wired into them.
 *
 * WHY THIS SET EXISTS. A prompt that places a picker by label (`{Motion}`) does
 * not go through the cinematography collector, which already passes the graph
 * for `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`. It resolves to text the server
 * derives in three other places: the orchestrator's parameter pre-completion
 * and the sub-workflow handler's (both store `nodeStates[id].output.text`), and
 * the parameter fallback in `buildNodeRefMap`. Those used to call
 * `getParameterPromptHint(node)` with no graph. For character-motion that drops
 * the target / partner names AND the minor-age floor, so a server run shipped an
 * adult-only move for a minor Character. The editor had already dropped that
 * move, because it composes the `{Label}` value with the graph
 * (`extractNodeOutput` in the frontend execution-graph.ts).
 *
 * CAMERA-MOTION IS DELIBERATELY NOT HERE, although it is in
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`. Its server `{Label}` output has
 * always been context-free: start / end states are not composed on this path.
 * Composing it now would change the prompt of workflows that already exist,
 * which needs its own signed-off change. Transition and Character FX stay
 * context-free here for the same reason.
 *
 * ADD A NEW GRAPH-COMPOSED PICKER HERE (and to
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`) when it ships. Its `{Label}` text
 * then matches the editor and the cinematography path from its first release,
 * and no existing workflow's prompt changes.
 */
export const LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "character-motion",
])

/**
 * The graph context to hand `getParameterPromptHint` when the server derives a
 * parameter node's `{Label}` text. Returns `{ nodes, edges }` for a type in
 * `LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES`, and `undefined` for every other
 * type, which keeps its historical context-free text. Pass the graph the node
 * lives in: a sub-workflow passes its SUB-graph.
 */
export function labelRefHintContext(
  node: HintNodeLike | undefined,
  nodes: ReadonlyArray<HintNodeLike>,
  edges: ReadonlyArray<HintEdgeLike>,
): HintGraphContext | undefined {
  if (!node?.type || !LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES.has(node.type)) return undefined
  return { nodes, edges }
}
