/**
 * "This node is empty ON PURPOSE."
 *
 * On load the editor recovers results that arrived while it was closed: any
 * node with no result gets the last run's output painted onto it
 * (`applyCompletedExecutionResults` for whole-workflow runs,
 * `reconcileCompletedSingleNodeJobs` for per-node runs). After "Clear results"
 * EVERY node looks exactly like that, so without a record of the clear the
 * next reload would quietly bring everything back.
 *
 * The record is a watermark on the node itself — `data.resultsClearedAt`, the
 * time of the clear — and the rule both lanes apply is: a cleared node takes
 * nothing from a run that SETTLED at or before its watermark. A run started
 * after the clear settles later and is recovered as always, which is the case
 * those lanes exist for.
 *
 * SETTLED, not started, and on purpose. The clear is refused while this canvas
 * shows anything running, so a job that was in flight at the clear was started
 * somewhere this canvas could not see (another tab). Its result did not exist
 * yet — the person cleared what was ON the canvas, not work still being paid
 * for — so when it lands it is new, and it is recovered.
 *
 * Why on the node and not on the workflow: node data is the one thing every
 * writer already carries whole — delta saves, full saves, the conflict rebase,
 * realtime adoption in a second tab, undo snapshots. A workflow-level field
 * would have to be threaded through each of those, and the full-save path
 * REPLACES `settings`, so a tab that loaded before the clear would erase it.
 * Undo needs no special case either: the snapshot it restores predates the
 * stamp.
 *
 * The watermark is a CLIENT clock compared with SERVER timestamps. A clock
 * that runs behind would let the run just cleared look newer than the clear,
 * so the stamp is never earlier than the last save the server acknowledged
 * (`loadedUpdatedAt`, a server time — and the autosave that follows a run's
 * last result lands after that run settled). A clock that runs AHEAD by N
 * seconds can still hide a run that settles within N seconds of the clear
 * while the editor is closed; its files are in the library either way.
 */
export const RESULTS_CLEARED_AT_KEY = "resultsClearedAt"

/** The watermark for a clear happening now. */
export function resultsClearedWatermark(nowMs: number, loadedUpdatedAt: string | null | undefined): string {
  const savedMs = loadedUpdatedAt ? Date.parse(loadedUpdatedAt) : Number.NaN
  return new Date(Number.isFinite(savedMs) ? Math.max(nowMs, savedMs + 1) : nowMs).toISOString()
}

/**
 * Whether a run that settled at `settledAt` is one this node was cleared of.
 * False for a node that was never cleared. A run with no usable timestamp
 * cannot be shown to be newer than the clear, so the clear wins.
 */
export function settledBeforeClear(
  data: Readonly<Record<string, unknown>> | undefined,
  settledAt: string | null | undefined,
): boolean {
  const stamp = data?.[RESULTS_CLEARED_AT_KEY]
  if (typeof stamp !== "string") return false
  const clearedMs = Date.parse(stamp)
  if (!Number.isFinite(clearedMs)) return false
  const settledMs = settledAt ? Date.parse(settledAt) : Number.NaN
  if (!Number.isFinite(settledMs)) return true
  return settledMs <= clearedMs
}
