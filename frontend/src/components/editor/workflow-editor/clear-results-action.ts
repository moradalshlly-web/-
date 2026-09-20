/**
 * The "Clear results" button: apply `clearRunResults` to the live canvas as ONE
 * undoable edit, and say what happened.
 *
 * There is no confirmation dialog on purpose. The action is one Undo away from
 * being reversed — the toast carries that Undo, and the toolbar's own Undo /
 * Ctrl+Z do the same — so a dialog would only be a second click on every use.
 * Nothing leaves the account either: generated files stay in the library and
 * past runs stay in the Executions tab; only the canvas is cleaned — and it
 * STAYS clean across a reload, because every cleared node is stamped with the
 * time of the clear (lib/results-cleared.ts).
 */
import { toast } from "sonner"
import { flushPendingUndoSnapshot, pendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { useUndoRedoStore, type WorkflowSnapshot } from "@/hooks/use-undo-redo-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { resultsClearedWatermark } from "@/lib/results-cleared"
import { clearRunResults, isRunInProgress } from "./clear-run-results"

export type ClearResultsOutcome = "cleared" | "nothing" | "busy" | "read-only"

/** How long the confirmation (and its Undo) stays up. */
const UNDO_TOAST_MS = 10_000

/** More steps than the history holds — a bound, so a loop below can never spin. */
const MAX_UNDO_STEPS = 60

/**
 * Take the canvas back to exactly how it was before the clear.
 *
 * The toast outlives the click by ten seconds, and the person may have edited
 * something in between; a single Undo would then take back THAT edit and leave
 * the results gone. So this undoes until the clear's own step is off the
 * history (later edits move to Redo), and does nothing if Ctrl+Z already got
 * there first.
 */
function undoClear(step: WorkflowSnapshot | null, undo: () => void): void {
  flushPendingUndoSnapshot()
  if (!step) {
    undo()
    return
  }
  let steps = 0
  while (steps < MAX_UNDO_STEPS && useUndoRedoStore.getState().past.includes(step)) {
    undo()
    steps++
  }
  // A button that did nothing, or more than it said, has to say so. The step is
  // gone when Ctrl+Z got there first — or when the history was reset under it
  // (another tab's save was adopted, which starts a new history).
  if (steps === 0) toast.info(tx("clearResults.undoGone"))
  else if (steps > 1) toast.info(tx("clearResults.undoTookLater", { n: steps - 1 }))
}

export function clearWorkflowResults(undo: () => void): ClearResultsOutcome {
  const store = useWorkflowStore.getState()
  if (store.isReadOnly) return "read-only"

  // A run in progress repaints whatever it touches on its next status tick, so
  // a clear under it would half-apply. Say why, rather than doing nothing.
  if (isRunInProgress(store.nodes)) {
    toast.info(tx("clearResults.busy"))
    return "busy"
  }

  // The clear must be its own undo step: close whatever step is still open.
  flushPendingUndoSnapshot()

  let clearedCount = 0
  const clearedAt = resultsClearedWatermark(Date.now(), store.loadedUpdatedAt)
  const changed = store.editGraph((graph) => {
    const outcome = clearRunResults(graph.nodes, graph.edges, clearedAt)
    if (!outcome) return null
    clearedCount = outcome.clearedCount
    return { nodes: outcome.nodes, edges: outcome.edges }
  })
  if (!changed) {
    toast.info(tx("clearResults.nothing"))
    return "nothing"
  }

  // The step stays OPEN (not flushed): anything the canvas writes in reaction
  // to the clear within the burst window joins it, and stays one Undo.
  const step = pendingUndoSnapshot()

  const title =
    clearedCount === 1
      ? tx("clearResults.doneOne")
      : clearedCount > 1
        ? tx("clearResults.done", { n: clearedCount })
        : tx("clearResults.doneGeneric")
  toast.success(title, {
    description: tx("clearResults.kept"),
    duration: UNDO_TOAST_MS,
    action: { label: tx("ctb.undo"), onClick: () => undoClear(step, undo) },
  })
  return "cleared"
}
