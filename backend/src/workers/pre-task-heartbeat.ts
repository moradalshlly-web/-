/**
 * Host-side liveness for every job the video worker runs.
 *
 * THE GAP (staging 2026-09-15, Pro 3D Render job 99ede351). The video worker
 * stamps `provider_kind = "pre-task"` + `provider_call_started_at = now` on
 * EVERY row it picks up (`video-worker.ts`), and the reconcile cron fails and
 * refunds a `pre-task` row whose stamp is older than
 * `STALE_THRESHOLD_MS["pre-task"]` (30 min) — `pre-task` is a sync kind, so the
 * sweep has nothing to recover and assumes the worker died. A run that
 * legitimately outlives the threshold must therefore refresh the stamp. Core
 * handlers that run long do (`SCENE3D_HEARTBEAT_MS`,
 * `LLM_STRUCTURED_HEARTBEAT_MS`); a private plugin had to remember to, and the
 * Pro 3D Render and advanced-preview workers never did — their only heartbeat
 * renews a stage-journal lease in Redis. The 30-second round-table fixture
 * runs 30–35 minutes, and was failed at minute 31 by the cron while its worker
 * was still rendering on the one container that ran it.
 *
 * THE INVARIANT. The worker wraps the handler AT ITS DISPATCH SITE — the one
 * place a handler is looked up by job name and run (`video-worker.ts`) — so
 * liveness is a property of dispatch itself, not of any map, merge order or
 * handler's memory: a future job type is covered the day it ships, with no
 * list to update. (The wrap once covered only the plugin loader's map; a core
 * ffmpeg long-runner — an hour-long multicam apply-edl cut — had the same
 * exposure.) A core handler with its own heartbeat is unaffected: both refresh
 * the same stamp, and the refresh is idempotent.
 *
 * WHAT "LIVE" MEANS. The refresh beats while the handler's promise is
 * unsettled in THIS process. If the process dies (deploy, OOM, SIGKILL) the
 * beats stop with it, the stamp ages, and the cron recovers the row exactly as
 * before — or BullMQ's stall re-pick gets there first and re-stamps it. The
 * refresh is a CAS on `provider_kind = "pre-task"` (`refreshPreTaskSentinel`),
 * so it never resurrects a sentinel a plugin cleared on purpose (gvp/evp, which
 * the 90-minute orchestrator sweep owns) and never overwrites a real provider
 * kind a handler moved the row to.
 *
 * WHY IT STOPS. A handler whose promise never settles would otherwise be kept
 * alive forever, and the 30-minute sweep is also the backstop for a HUNG
 * handler. The beats stop after `PRE_TASK_HEARTBEAT_MAX_MS`, so a hung job is
 * still failed and refunded, one threshold later. The cap is sized to the
 * longest LEGITIMATE run this worker performs, not to the orchestrator's
 * per-node ceiling: a job reached through a direct lane (`POST /v1/apply-edl`,
 * the MCP verb) has no orchestrator watching it, and a final-quality render
 * of a maximum-length episode is hours of ffmpeg on a shared box. A run that
 * outlives the cap is still failed and refunded one threshold later — that is
 * the residual, stated here so "covered" is not read as unbounded.
 *
 * DRAIN HAND-OFF (app PR #1436). A drain hand-off leaves the handler with
 * `DrainAbortError`; the `finally` below stops the beats, the row keeps a stamp
 * at most one interval old, the worker moves the job back to the queue with a
 * short delay, and the successor's pickup writes a fresh stamp. The guard
 * tests pin interval + requeue delay far below the threshold.
 */
import { refreshPreTaskSentinel } from "../lib/reconcile/persistence.js"

/** Beat cadence. Same as the core long-runners (`SCENE3D_HEARTBEAT_MS`) and the
 *  video-analysis plugin: one missed write still leaves 28 minutes of margin. */
export const PRE_TASK_HEARTBEAT_MS = 60_000

/** How long the host keeps a still-running job looking live. Past this a run
 *  is treated as hung and left to age into the ordinary sweep. Sized above the
 *  longest legitimate run on this worker: the longest deliverable is a
 *  maximum-length episode (`EDIT_PLAN_MAX_MINUTES`) cut by apply-edl, whose
 *  final-quality render runs at roughly 1–2× real time on a shared 2-vCPU
 *  box — the cap clears that envelope with margin, and the orchestrator's own
 *  per-node ceiling (`NODE_TIMEOUT_MS`) sits well inside it. A hung handler is
 *  a bug, and a bug is caught a shift later rather than a live render being
 *  failed while it still works; the guard test pins both bounds. */
export const PRE_TASK_HEARTBEAT_MAX_MS = 8 * 60 * 60_000

type QueueHandler<J, C extends { jobId: string }> = (job: J, ctx: C) => Promise<void>

/** One handler, beating while it runs. */
export function withPreTaskHeartbeat<J, C extends { jobId: string }>(
  handler: QueueHandler<J, C>,
): QueueHandler<J, C> {
  return async (job, ctx) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= PRE_TASK_HEARTBEAT_MAX_MS) {
        clearInterval(timer)
        return
      }
      // Best-effort by contract; the catch is belt and braces so a future edit
      // to the refresh can never surface as an unhandled rejection here.
      void refreshPreTaskSentinel(ctx.jobId).catch(() => undefined)
    }, PRE_TASK_HEARTBEAT_MS)
    timer.unref?.()
    try {
      await handler(job, ctx)
    } finally {
      clearInterval(timer)
    }
  }
}
