import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkerShutdown } from "../worker-shutdown.js"
import { inFlightDrainDeadlineMs, SHUTDOWN_DRAIN_MS } from "../worker-drain.js"

/**
 * SIGTERM arriving while the video worker is running a paid Scene3D stage.
 *
 * MEASURED 2026-09-15 on staging: Pro job 35bd1f1f was 16 s into repair pass 3's
 * planner call (bounded at 360 s) when deployment 172d0994 received SIGTERM; the
 * container was gone 11 s later and the successor failed and refunded the run.
 * These tests pin the process half of the fix: the drain lasts as long as the
 * platform window allows, so an in-flight stage can finish and persist before
 * the process exits.
 */

const RAILWAY_WINDOW = { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "420" }

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function harness(deadlineMs: number, close: () => Promise<unknown>) {
  const order: string[] = []
  const exit = vi.fn((code: number) => { order.push(`exit:${code}`) })
  const beginDrain = vi.fn(() => { order.push("beginDrain") })
  const worker = { close: vi.fn(() => { order.push("close"); return close() }) }
  const log = { warn: vi.fn(), error: vi.fn() }
  const shutdown = createWorkerShutdown({ label: "worker", worker, deadlineMs, beginDrain, exit, log })
  return { shutdown, exit, beginDrain, worker, log, order }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("worker shutdown — SIGTERM during an in-flight paid stage", () => {
  it("drains first, waits for the stage to settle inside the platform window, then exits 0", async () => {
    const stage = deferred()
    // The in-flight planner call answers 300 s after SIGTERM, and BullMQ's
    // close() settles once the handler hands the job back.
    setTimeout(() => stage.resolve(), 300_000)
    const h = harness(inFlightDrainDeadlineMs(RAILWAY_WINDOW), () => stage.promise)

    void h.shutdown("SIGTERM")
    // The drain flag is up BEFORE close(): the stage boundary after this call
    // must already see it.
    expect(h.order.slice(0, 2)).toEqual(["beginDrain", "close"])

    await vi.advanceTimersByTimeAsync(299_999)
    expect(h.exit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledWith(0)

    // The hard-exit timer was cleared: nothing fires later.
    await vi.advanceTimersByTimeAsync(600_000)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it("the old fixed 25 s deadline kills that same stage long before it can answer", async () => {
    // Why the deadline is derived: with SHUTDOWN_DRAIN_MS the process exits
    // mid-call, the invocation marker stays open, and the successor refuses to
    // pay for the stage again.
    const stage = deferred()
    setTimeout(() => stage.resolve(), 300_000)
    const h = harness(SHUTDOWN_DRAIN_MS, () => stage.promise)

    void h.shutdown("SIGTERM")
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS)
    expect(h.exit.mock.calls[0]).toEqual([1])
    expect(h.log.error).toHaveBeenCalledWith("[worker] Drain timed out, forcing exit")
  })

  it("a drain that never settles hard-exits exactly at the deadline", async () => {
    const h = harness(inFlightDrainDeadlineMs(RAILWAY_WINDOW), () => new Promise(() => {}))

    void h.shutdown("SIGTERM")
    await vi.advanceTimersByTimeAsync(414_999)
    expect(h.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.exit).toHaveBeenCalledWith(1)
  })

  it("a second signal is ignored — one drain, one close", async () => {
    const stage = deferred()
    const h = harness(inFlightDrainDeadlineMs(RAILWAY_WINDOW), () => stage.promise)

    void h.shutdown("SIGTERM")
    void h.shutdown("SIGINT")
    expect(h.beginDrain).toHaveBeenCalledTimes(1)
    expect(h.worker.close).toHaveBeenCalledTimes(1)

    stage.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledWith(0)
  })

  it("a close() that rejects still exits 0 with the timer cleared", async () => {
    const stage = deferred()
    const h = harness(inFlightDrainDeadlineMs(RAILWAY_WINDOW), () => stage.promise)

    void h.shutdown("SIGTERM")
    stage.reject(new Error("Connection is closed."))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.exit).toHaveBeenCalledWith(0)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.log.error).toHaveBeenCalledWith("[worker] Error during drain:", expect.any(Error))
  })
})
