/**
 * Cooperative drain signal for worker processes.
 *
 * Why this exists (incident 2026-07-15): Railway deploys stop the old
 * container while provider poll loops are mid-flight. If the process dies
 * with BullMQ jobs still active, their locks stay held by a dead process and
 * the jobs are invisible to stall recovery until `lockDuration` expires —
 * users watched `processing` rows freeze for 15–20 minutes while the
 * provider had long finished.
 *
 * The worker entrypoint calls `beginWorkerDrain()` on SIGTERM/SIGINT, BEFORE
 * `worker.close()`. Provider wait points (the shared poll `sleep` in
 * `providers/kie/client.ts`) then throw `DrainAbortError`, the handler exits
 * fast, the video-worker catch RETHROWS it (never mark-failed, never refund),
 * and BullMQ moves the job back to the queue with its lock released — so the
 * replacement process re-picks it seconds after boot and the stall guard's
 * inline reconcile recovers it immediately.
 *
 * WHO SETS IT. Worker entrypoints only: `worker.ts` (video worker) and
 * `orchestrator.ts` (the dedicated orchestrator process started by
 * Dockerfile's `supervise orchestrator`). The API server (`server.ts`) hosts
 * an orchestrator worker too but must NOT set the flag — it also serves HTTP,
 * and aborting an in-flight request's provider poll would surface as a 500 and
 * an `internal-error` app-report row. Cron paths never drain.
 *
 * TWO KINDS OF IN-FLIGHT WORK (2026-09-15). A provider POLL can be abandoned at
 * any wait point — the task lives upstream and the replacement re-attaches to
 * it. A paid model call made from INSIDE this process cannot: its response
 * lives only in this process, and a Scene3D metered stage writes an invocation
 * marker before it pays, so a call killed mid-flight leaves the successor a
 * marker with no result (`SceneStageAmbiguousError`, which refuses to pay
 * twice and fails the run). For that kind the drain must do the opposite of
 * aborting: let the in-flight call finish and persist, and hand the job back
 * at the next stage BOUNDARY — see `workerDrainSignal`, the journal's
 * `handOffOnDrain` claim option (`private-plugins/stage-journal.ts`) and
 * `inFlightDrainDeadlineMs` below.
 */

/**
 * The FAST drain deadline: how long a process that aborts its own waits may
 * take before its hard-exit timer fires. Used by `orchestrator.ts`,
 * `render-worker.ts` and `server.ts`.
 *
 * MEASURED 2026-09-15 on staging, where `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`
 * is not set: SIGTERM at 14:38:02.16Z → "Stopping Container" at 14:38:13.5Z
 * (deployment 172d0994), and 09:56:55.1Z → 09:57:06.3Z (deployment 7376c19f)
 * — the platform kills ~11 s after SIGTERM, not the ~30 s this constant used
 * to assume, and Railway documents the unset default as 0. So without the
 * variable this timer never fires first; the value only matters once the
 * variable gives the container a longer window.
 *
 * The API server deliberately stays on this short deadline even when the
 * platform window is long: its in-process orchestrator worker does NOT set the
 * drain flag, so `orchestratorWorker.close()` waits on active executions for as
 * long as it is allowed to — a platform-length deadline there would keep a
 * dying container orchestrating for minutes and delay the new container's
 * stall recovery of those executions by the same amount.
 */
export const SHUTDOWN_DRAIN_MS = 25_000

/** Left between the process's own exit and the platform's SIGKILL, so the
 *  final drain log lines are flushed rather than cut. */
export const DRAIN_EXIT_MARGIN_MS = 5_000

/** The floor for any derived deadline — a misconfigured tiny window must still
 *  leave the exit path time to run. */
const MIN_DRAIN_DEADLINE_MS = 1_000

/**
 * The platform's SIGTERM → SIGKILL window in ms, read from Railway's own
 * service variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` — the SAME value the
 * platform enforces, so the process and the platform cannot disagree about
 * the deadline. `undefined` when unset or not a positive number of seconds
 * (the window is then the platform default, measured at ~11 s above).
 */
export function platformDrainWindowMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS?.trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.round(seconds * 1000)
}

/**
 * The drain deadline for a process that FINISHES in-flight work instead of
 * aborting it — the video worker, where a private plugin's paid model call can
 * be mid-flight (a Scene3D planner call is bounded at 360 s, a critic batch at
 * 240 s, plus up to 20 s to persist the result).
 *
 * The whole platform window minus the exit margin, so the in-flight stage gets
 * every second the platform grants; `SHUTDOWN_DRAIN_MS` when the window is
 * unknown (unchanged behaviour on an install that never set the variable).
 * Idle or poll-only workers are unaffected: `worker.close()` resolves as soon
 * as the active handlers settle, and provider polls settle at once.
 */
export function inFlightDrainDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const window = platformDrainWindowMs(env)
  if (window === undefined) return SHUTDOWN_DRAIN_MS
  return Math.max(MIN_DRAIN_DEADLINE_MS, window - DRAIN_EXIT_MARGIN_MS)
}

export class DrainAbortError extends Error {
  constructor(message = "worker draining (deploy restart) — provider wait aborted") {
    super(message)
    this.name = "DrainAbortError"
  }
}

/** How deep `isDrainAbortError` follows `cause` — bounded so a cycle cannot spin. */
const CAUSE_HOPS = 8

/**
 * Whether a thrown value IS, or wraps, a drain abort.
 *
 * Walks the `cause` chain because the error that reaches the queue catch is
 * often not the one the drain produced: a private plugin that hands a job back
 * at a stage boundary may wrap the host's `DrainAbortError` in its own run
 * error on the way out. Matches the class OR the stable name, because a plugin
 * bundle can carry its own copy of the class (the recast plugin already
 * classifies it by name).
 */
export function isDrainAbortError(error: unknown): boolean {
  let current: unknown = error
  for (let hop = 0; hop < CAUSE_HOPS && current !== null && typeof current === "object"; hop++) {
    if (current instanceof DrainAbortError || (current as { name?: unknown }).name === "DrainAbortError") return true
    const next = (current as { cause?: unknown }).cause
    if (next === current) return false
    current = next
  }
  return false
}

let draining = false
let drainController = new AbortController()

/** Idempotent: flip the process-wide drain flag and abort the drain signal.
 *  Called from the worker entrypoint's SIGTERM handler before `worker.close()`. */
export function beginWorkerDrain(): void {
  draining = true
  if (!drainController.signal.aborted) drainController.abort(new DrainAbortError())
}

export function isWorkerDraining(): boolean {
  return draining
}

/**
 * The process drain as an `AbortSignal`: aborted by `beginWorkerDrain()`, with
 * a `DrainAbortError` as its `reason`. For work that should stop WAITING the
 * moment the process drains (a poll, a queue wait) — never for a paid call
 * whose result would then be lost; that kind finishes and hands off at the
 * next boundary instead.
 */
export function workerDrainSignal(): AbortSignal {
  return drainController.signal
}

/** Test helper — drain state is process-global, reset between tests. */
export function _resetWorkerDrainForTests(): void {
  draining = false
  drainController = new AbortController()
}
