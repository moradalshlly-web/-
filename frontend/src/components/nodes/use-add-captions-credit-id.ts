import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { addCaptionsCreditId, addCaptionsTimedSourceWired } from "@/components/editor/config-panels/helpers"

/**
 * The credit row an Add Captions node's own badge / Run pill must quote — the
 * SAME id `getModelIdentifier` gives the config panel's Generate button, the
 * Execute total and the pre-run precheck, so one screen can never show two
 * prices for one node.
 *
 * The pill used to quote the generic `ffmpeg` row (10) while every canvas run
 * reserves 30 or 50 — a 5x under-quote on the default node, whose only caption
 * source is transcription.
 *
 * Edge-aware: a Transcript wired into the `transcript` handle, or a transcribe
 * node wired in, is a TIMED caption source and means the Remotion price whatever
 * the node data says. The store selector returns that one BOOLEAN, so the node
 * re-renders only when the answer changes — not on every store write (the
 * lightweight-selector pattern of `useUpstreamImageAspect`).
 */
export function useAddCaptionsCreditId(nodeId: string, data: Record<string, unknown>): string {
  const wiredTimedSource = useWorkflowStore((s) => addCaptionsTimedSourceWired(nodeId, s.edges, s.nodes))
  return addCaptionsCreditId(data, wiredTimedSource)
}
