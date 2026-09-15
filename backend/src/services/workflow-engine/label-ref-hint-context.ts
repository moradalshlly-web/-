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
 * CAMERA-MOTION COMPOSES HERE AS OF THIS CHANGE. Its server `{Label}` text was
 * context-free until now — start / end states were dropped on this path only —
 * so a `{Cam}` ref disagreed with the editor, which has always composed it, and
 * with the cinematography path, which passes the graph for every member of
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`. The blast radius was measured
 * before the flip: with nothing wired to a picker's identity / state handles the
 * with-graph and without-graph strings are byte-identical (0 differences across
 * 472,168 comparisons), so ONLY workflows that actually wire camera-motion's
 * startState / endState change at all — and they change to the text the editor
 * already shows for them.
 *
 * TRANSITION AND CHARACTER-FX STAY OUT. They are not in
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`, so admitting them here would not
 * be aligning the `{Label}` path with an already-composed execution path — it
 * would newly compose them, and the same widening on the execution side would
 * also change the prompts of workflows that wire them DIRECTLY (the
 * cinematography handle), not just by label. That is its own signed-off change.
 *
 * ADD A NEW GRAPH-COMPOSED PICKER TO BOTH SETS — here and
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES` — when it ships. Its `{Label}` text
 * then matches the editor and the cinematography path from its first release,
 * and no existing workflow's prompt changes. This set stays a SUBSET of that
 * one: a type composed by label but not on the execution path would disagree
 * with itself depending on how the prompt placed it.
 */
export const LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "camera-motion",
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
