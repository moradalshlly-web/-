/**
 * The SIGTERM/SIGINT drain sequence of a queue-worker process, as a function
 * the entrypoint wires to its signals and a test can drive with fake timers.
 *
 * Order is the contract:
 *
 *   1. `beginDrain()` — flips the process drain (lib/worker-drain.ts) BEFORE
 *      the close, so every drain-aware wait point and stage boundary sees it
 *      while the active handlers are still running;
 *   2. `worker.close()` — BullMQ stops fetching and waits for the active jobs
 *      to settle, renewing their locks the whole time (it closes its lock
 *      manager only after `whenCurrentJobsFinished`), so a long drain never
 *      lets a successor pick up a job this process is still running;
 *   3. `exit(0)` once the drain is complete — or `exit(1)` from the hard-exit
 *      timer at `deadlineMs`, whichever comes first.
 *
 * The timer is deliberately NOT unref'd: while `close()` is pending the ioredis
 * sockets hold the loop open anyway, and a ref'd timer guarantees the
 * "timed out → exit 1" diagnostic instead of a silent exit.
 */

export interface DrainableWorker {
  close(): Promise<unknown>
}

export interface WorkerShutdownOptions {
  /** Log prefix, e.g. "worker". */
  label: string
  worker: DrainableWorker
  /** Hard-exit deadline in ms, measured from the first signal. */
  deadlineMs: number
  beginDrain: () => void
  exit: (code: number) => void
  log?: Pick<Console, "warn" | "error">
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** Returns the signal handler. Idempotent: a second signal is ignored. */
export function createWorkerShutdown(options: WorkerShutdownOptions): (signal: string) => Promise<void> {
  const log = options.log ?? console
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let shuttingDown = false
  return async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.warn(`[${options.label}] ${signal} received — draining (≤${options.deadlineMs}ms before forced exit)`)
    const hardExit = setTimer(() => {
      log.error(`[${options.label}] Drain timed out, forcing exit`)
      options.exit(1)
    }, options.deadlineMs)
    try {
      options.beginDrain()
      await options.worker.close()
      log.warn(`[${options.label}] Drain complete.`)
    } catch (err) {
      log.error(`[${options.label}] Error during drain:`, err)
    } finally {
      clearTimer(hardExit)
      options.exit(0)
    }
  }
}
