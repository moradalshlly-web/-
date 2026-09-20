/**
 * Hook that auto-executes an inline node when its config fields change.
 * Debounced at 300ms. Skips on initial mount and workflow load.
 */

import { useEffect, useMemo, useRef } from "react"
import { useWorkflowStore, EXECUTION_DATA_KEYS } from "@/hooks/use-workflow-store"
import { autoExecuteNode } from "@/components/editor/workflow-editor/auto-execute"
import { RUN_RESULT_EXTRA_KEYS } from "@/components/editor/workflow-editor/clear-run-results"

/**
 * Keys that are NOT config — changes to these should NOT trigger auto-execute.
 *
 * Exported for the guard in clear-run-results.test.ts: "Clear results" REMOVES
 * result keys, and a removal this set does not know about reads as a config
 * change — the inline node would re-run 300 ms after being cleared and paint
 * its result straight back.
 */
export const AUTO_EXECUTE_IGNORE_KEYS: ReadonlySet<string> = new Set([
  ...EXECUTION_DATA_KEYS,
  // Extra output keys not in the undo set
  "generatedJson", "__listInputs",
  // Node-specific outputs
  "combinedText", "splitResults", "extractedText", "listResults",
  // Every other result field runs write outside the registry (one list, shared
  // with the clear — fan-out bookkeeping like `__currentRunId` lives there).
  ...RUN_RESULT_EXTRA_KEYS,
  // Meta fields
  "label", "presentationInput", "presentationOutput", "skipped", "__expandedClone",
])

function configSnapshot(data: Record<string, unknown>): string {
  const config: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (!AUTO_EXECUTE_IGNORE_KEYS.has(key)) config[key] = data[key]
  }
  return JSON.stringify(config)
}

/**
 * Watches a node's config fields and triggers auto-execution on change.
 * @param nodeId  The node to auto-execute
 * @param data    The full node data object (from React Flow props)
 */
export function useAutoExecute(nodeId: string, data: Record<string, unknown>): void {
  const loadGen = useWorkflowStore((s) => s.loadGeneration)
  const prevSnapshot = useRef<string>("")
  const prevLoadGen = useRef(loadGen)
  const mounted = useRef(false)

  // Memoized on the data reference so canvas pan/zoom (which preserves
  // data identity) doesn't re-stringify large config objects like Router's
  // nested conditionGroups on every render.
  const snapshot = useMemo(() => configSnapshot(data), [data])

  useEffect(() => {
    // Skip first render (initial mount)
    if (!mounted.current) {
      mounted.current = true
      prevSnapshot.current = snapshot
      prevLoadGen.current = loadGen
      return
    }

    // Skip when workflow was just loaded/switched (loadGeneration changed)
    if (loadGen !== prevLoadGen.current) {
      prevLoadGen.current = loadGen
      prevSnapshot.current = snapshot
      return
    }

    // Skip if config didn't actually change
    if (snapshot === prevSnapshot.current) return
    prevSnapshot.current = snapshot

    const timer = setTimeout(() => {
      autoExecuteNode(nodeId)
    }, 300)

    return () => clearTimeout(timer)
  }, [snapshot, nodeId, loadGen])
}
