/**
 * The host-side `pre-task` heartbeat that keeps a live run from being failed +
 * refunded by the reconcile sweep (staging Pro 3D Render job 99ede351, failed
 * at minute 31 while its worker was still running).
 *
 * The end-to-end half — a real cron tick against a row the beats keep fresh —
 * lives in `lib/reconcile/__tests__/pre-task-liveness.test.ts`; that the video
 * worker wraps EVERY handler it dispatches, core and plugin alike, lives in
 * `video-worker.test.ts` (beats counted through the processor) and
 * `video-worker-heartbeat-wiring.test.ts` (the dispatch-site wrap is present).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.hoisted(() => vi.fn(async (_jobId: string): Promise<void> => {}))
vi.mock("../../lib/reconcile/persistence.js", () => ({ refreshPreTaskSentinel: refresh }))

import {
  PRE_TASK_HEARTBEAT_MAX_MS,
  PRE_TASK_HEARTBEAT_MS,
  withPreTaskHeartbeat,
} from "../pre-task-heartbeat.js"
import { STALE_THRESHOLD_MS, isSyncKind } from "../../lib/reconcile/types.js"
import { NODE_TIMEOUT_MS } from "../../services/workflow-engine/types.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { EDIT_PLAN_MAX_MINUTES } from "@nodaro/shared"

const MIN = 60_000
const THRESHOLD = STALE_THRESHOLD_MS["pre-task"]
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

beforeEach(() => {
  refresh.mockReset()
  refresh.mockResolvedValue(undefined)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-15T18:18:44Z"))
})
afterEach(() => vi.useRealTimers())

describe("withPreTaskHeartbeat", () => {
  it("beats for its job once per interval while the handler runs, and never after it settles", async () => {
    const run = withPreTaskHeartbeat(async () => { await sleep(35 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(35 * MIN)
    await run

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(34)
    expect(new Set(refresh.mock.calls.map(([jobId]) => jobId))).toEqual(new Set(["job-1"]))

    const beats = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("no gap between beats across a 35-minute run comes anywhere near the sweep threshold", async () => {
    const startedAt = Date.now()
    const stamps: number[] = []
    refresh.mockImplementation(async () => { stamps.push(Date.now()) })

    const run = withPreTaskHeartbeat(async () => { await sleep(35 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(35 * MIN)
    await run

    // The pickup stamp is the first "beat"; every later one must follow within an interval.
    const gaps = [startedAt, ...stamps].slice(1).map((at, i) => at - [startedAt, ...stamps][i]!)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(PRE_TASK_HEARTBEAT_MS)
    expect(Date.now() - stamps.at(-1)!).toBeLessThan(THRESHOLD)
  })

  it("stops on a drain hand-off and lets the DrainAbortError leave untouched (the worker requeues on it)", async () => {
    const drain = new DrainAbortError()
    const run = withPreTaskHeartbeat(async () => {
      await sleep(5 * MIN)
      throw drain
    })({}, { jobId: "job-1" }).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(await run).toBe(drain)

    const beats = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("a refresh that fails never reaches the handler it is keeping alive", async () => {
    refresh.mockRejectedValue(new Error("database unavailable"))
    const run = withPreTaskHeartbeat(async () => { await sleep(3 * MIN) })({}, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await expect(run).resolves.toBeUndefined()
    expect(refresh).toHaveBeenCalled()
  })

  it("stops beating at PRE_TASK_HEARTBEAT_MAX_MS, so a handler that never settles still ages into the sweep", async () => {
    void withPreTaskHeartbeat(() => new Promise<void>(() => {}))({}, { jobId: "hung" })

    await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS)
    const beats = refresh.mock.calls.length
    expect(beats).toBeGreaterThanOrEqual(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS - 1)

    await vi.advanceTimersByTimeAsync(THRESHOLD + 10 * MIN)
    expect(refresh.mock.calls.length).toBe(beats)
  })

  it("concurrent jobs keep their own beats", async () => {
    const wrap = withPreTaskHeartbeat(async (_job: unknown, ctx: { jobId: string }) => {
      await sleep(ctx.jobId === "short" ? 2 * MIN : 6 * MIN)
    })
    const short = wrap({}, { jobId: "short" })
    const long = wrap({}, { jobId: "long" })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    await Promise.all([short, long])

    const byJob = (id: string) => refresh.mock.calls.filter(([jobId]) => jobId === id).length
    expect(byJob("short")).toBeLessThanOrEqual(2)
    expect(byJob("long")).toBeGreaterThanOrEqual(5)
  })
})

describe("liveness budget", () => {
  it("pre-task is a sync kind: its sweep fails + refunds, so a live run's only protection is a fresh stamp", () => {
    expect(isSyncKind("pre-task")).toBe(true)
  })

  it("one missed beat still leaves the row well inside the threshold", () => {
    expect(2 * PRE_TASK_HEARTBEAT_MS).toBeLessThan(THRESHOLD)
  })

  // The cap is what bounds a job on a DIRECT lane (no orchestrator ceiling), so
  // it must clear the longest legitimate run on this worker — a final-quality
  // apply-edl render of a maximum-length episode at ~2× real time — and it must
  // outlast the orchestrator's own per-node ceiling, or a DAG node would lose
  // its beats before the orchestrator gave up on it. A run past the cap is the
  // stated residual: failed + refunded one threshold later.
  it("the cap outlasts the threshold (or it would re-open the gap), the orchestrator's per-node ceiling, and the longest legitimate render", () => {
    expect(PRE_TASK_HEARTBEAT_MAX_MS).toBeGreaterThan(THRESHOLD)
    expect(PRE_TASK_HEARTBEAT_MAX_MS).toBeGreaterThanOrEqual(NODE_TIMEOUT_MS)
    const longestRenderAtTwiceRealTime = 2 * EDIT_PLAN_MAX_MINUTES * MIN
    expect(PRE_TASK_HEARTBEAT_MAX_MS).toBeGreaterThanOrEqual(longestRenderAtTwiceRealTime)
  })
})
