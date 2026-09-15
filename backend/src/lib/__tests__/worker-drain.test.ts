import { describe, it, expect, beforeEach } from "vitest"
import {
  beginWorkerDrain,
  isWorkerDraining,
  DrainAbortError,
  isDrainAbortError,
  workerDrainSignal,
  platformDrainWindowMs,
  inFlightDrainDeadlineMs,
  SHUTDOWN_DRAIN_MS,
  _resetWorkerDrainForTests,
} from "../worker-drain.js"

describe("worker-drain", () => {
  beforeEach(() => {
    _resetWorkerDrainForTests()
  })

  it("is not draining by default", () => {
    expect(isWorkerDraining()).toBe(false)
  })

  it("beginWorkerDrain flips the flag (idempotent)", () => {
    beginWorkerDrain()
    expect(isWorkerDraining()).toBe(true)
    beginWorkerDrain()
    expect(isWorkerDraining()).toBe(true)
  })

  it("DrainAbortError carries a stable name for cross-module classification", () => {
    const err = new DrainAbortError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("DrainAbortError")
    expect(err.message).toContain("drain")
  })

  it("the drain signal aborts with a DrainAbortError reason, and a reset hands out a fresh one", () => {
    expect(workerDrainSignal().aborted).toBe(false)
    beginWorkerDrain()
    const signal = workerDrainSignal()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DrainAbortError)
    beginWorkerDrain() // idempotent: no second abort, same reason
    expect(workerDrainSignal().reason).toBe(signal.reason)
    _resetWorkerDrainForTests()
    expect(workerDrainSignal().aborted).toBe(false)
  })

  describe("isDrainAbortError — the queue catch recognises a hand-back however it arrives", () => {
    it("matches the host class directly", () => {
      expect(isDrainAbortError(new DrainAbortError())).toBe(true)
    })

    it("matches it wrapped in a plugin's own run error, several causes deep", () => {
      const handoff = new DrainAbortError()
      const stage = new Error("stage stopped", { cause: handoff })
      const run = new Error("Scene processing did not complete", { cause: stage })
      expect(isDrainAbortError(run)).toBe(true)
    })

    it("matches by stable name when a plugin bundle carries its own copy of the class", () => {
      const foreign = Object.assign(new Error("worker draining"), { name: "DrainAbortError" })
      expect(isDrainAbortError(new Error("wrapped", { cause: foreign }))).toBe(true)
    })

    it("does not match an ordinary failure, a non-object, or a cause cycle", () => {
      expect(isDrainAbortError(new Error("provider 503"))).toBe(false)
      expect(isDrainAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false)
      expect(isDrainAbortError("DrainAbortError")).toBe(false)
      expect(isDrainAbortError(undefined)).toBe(false)
      const cyclic = new Error("loop") as Error & { cause?: unknown }
      cyclic.cause = cyclic
      expect(isDrainAbortError(cyclic)).toBe(false)
    })
  })

  describe("the drain deadline follows the platform window", () => {
    it("reads RAILWAY_DEPLOYMENT_DRAINING_SECONDS, the value the platform itself enforces", () => {
      expect(platformDrainWindowMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "420" })).toBe(420_000)
      expect(platformDrainWindowMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: " 420 " })).toBe(420_000)
      expect(platformDrainWindowMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "7.5" })).toBe(7_500)
    })

    it("treats an unset or unusable value as an unknown window", () => {
      for (const value of [undefined, "", "0", "-5", "abc", "12s", "1e3"]) {
        expect(platformDrainWindowMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: value })).toBeUndefined()
      }
    })

    it("an in-flight drain gets the whole window minus the log-flush margin", () => {
      // 420 s covers the longest paid Scene3D stage (a 360 s planner call plus
      // up to 20 s to persist it) with room to hand the job back.
      expect(inFlightDrainDeadlineMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "420" })).toBe(415_000)
    })

    it("keeps the fixed deadline when the window is unknown, and a floor when it is tiny", () => {
      expect(inFlightDrainDeadlineMs({})).toBe(SHUTDOWN_DRAIN_MS)
      expect(inFlightDrainDeadlineMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "3" })).toBe(1_000)
    })
  })
})
