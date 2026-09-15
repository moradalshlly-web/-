import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import IORedis from "ioredis"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createStageJournal, type StageJournalDrain } from "../stage-journal.js"
import type { PluginStageKey } from "../scene3d-contract.js"
import {
  beginWorkerDrain,
  DrainAbortError,
  _resetWorkerDrainForTests,
} from "../../worker-drain.js"

/**
 * The durable stage journal during a deploy drain.
 *
 * MEASURED 2026-09-15 on staging: Pro jobs 351f0270 and 35bd1f1f were each killed
 * mid planner call by a container replacement. The successor re-ran the job,
 * replayed the completed stages, found the interrupted stage's invocation marker
 * with no result, and — correctly refusing to pay for the call a second time —
 * failed and refunded the run.
 *
 * The journal's half of the fix: an in-flight stage keeps every operation it
 * needs to FINISH (renew, checkpoint, complete, release), and an opted-in claim
 * refuses to OPEN a new stage once the process drains, leaving nothing behind
 * for the successor to find ambiguous.
 */

const key = (stage = "planning"): PluginStageKey => ({ jobId: randomUUID(), userId: randomUUID(), attemptIndex: 0,
  stage, inputHash: "a".repeat(64), engineVersion: "1.0.0" })

/** A Redis double answering the journal script: op is the 4th eval argument. */
function scriptedRedis() {
  const ops: string[] = []
  const redis = {
    eval: vi.fn(async (_script: string, _keys: number, _key: string, op: string, token: string, fence: number | string) => {
      ops.push(op)
      if (op === "claim") {
        return JSON.stringify({ status: "claimed", lease: { token, fence: Number(fence) + 1, expiresAt: Date.now() + 60_000 },
          checkpoint: null })
      }
      if (op === "renew") return JSON.stringify({ token, fence: Number(fence), expiresAt: Date.now() + 60_000 })
      return "true"
    }),
  }
  return { redis, ops }
}

afterEach(() => _resetWorkerDrainForTests())

describe("stage journal — SIGTERM at a stage boundary", () => {
  it("an opted-in claim refuses with DrainAbortError before authorization or any Redis write", async () => {
    const { redis } = scriptedRedis()
    const authorize = vi.fn(async () => {})
    const journal = createStageJournal(redis, authorize)

    beginWorkerDrain()
    await expect(journal.claim(key(), 60_000, { handOffOnDrain: true })).rejects.toBeInstanceOf(DrainAbortError)
    expect(authorize).not.toHaveBeenCalled()
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it("the refusal still validates the key and the lease first, exactly as a live claim would", async () => {
    const { redis } = scriptedRedis()
    const journal = createStageJournal(redis, async () => {})

    beginWorkerDrain()
    await expect(journal.claim({ ...key(), stage: "../../escape" }, 60_000, { handOffOnDrain: true }))
      .rejects.not.toBeInstanceOf(DrainAbortError)
    await expect(journal.claim(key(), 999, { handOffOnDrain: true })).rejects.toThrow("Invalid stage lease")
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it("a claim WITHOUT the option is unchanged during a drain — a plugin that predates the contract keeps today's behaviour", async () => {
    const { redis, ops } = scriptedRedis()
    const journal = createStageJournal(redis, async () => {})

    beginWorkerDrain()
    const claim = await journal.claim(key(), 60_000)
    expect(claim.status).toBe("claimed")
    expect(ops).toEqual(["claim"])
  })

  it("an opted-in claim is a normal claim while the process is not draining", async () => {
    const { redis, ops } = scriptedRedis()
    const journal = createStageJournal(redis, async () => {})

    expect((await journal.claim(key(), 60_000, { handOffOnDrain: true })).status).toBe("claimed")
    expect(ops).toEqual(["claim"])
  })
})

describe("stage journal — SIGTERM during an in-flight stage", () => {
  it("renew, checkpoint, complete and release all keep working after the drain begins", async () => {
    const { redis, ops } = scriptedRedis()
    const journal = createStageJournal(redis, async () => {})
    const k = key()

    const claim = await journal.claim(k, 60_000, { handOffOnDrain: true })
    if (claim.status !== "claimed") throw new Error("expected a claim")
    expect(await journal.checkpoint(k, claim.lease, { invoked: true, receipt: null })).toBe(true)

    beginWorkerDrain() // SIGTERM lands while the paid call is out

    expect(await journal.renew(k, claim.lease, 60_000)).not.toBeNull()
    expect(await journal.checkpoint(k, claim.lease, { invoked: true, receipt: { usage: 1 } })).toBe(true)
    expect(await journal.complete(k, claim.lease, { artifactId: "a1" })).toBe(true)
    expect(await journal.release(k, claim.lease)).toBe(true)
    expect(ops).toEqual(["claim", "checkpoint", "renew", "checkpoint", "complete", "release"])

    // ...and the NEXT boundary hands the job back.
    await expect(journal.claim(key("review"), 60_000, { handOffOnDrain: true })).rejects.toBeInstanceOf(DrainAbortError)
    expect(ops).toHaveLength(6)
  })

  it("exposes the process drain to plugin wait loops as an AbortSignal", () => {
    const { redis } = scriptedRedis()
    const journal = createStageJournal(redis, async () => {})
    expect(journal.drainSignal?.().aborted).toBe(false)
    beginWorkerDrain()
    const signal = journal.drainSignal!()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DrainAbortError)
  })

  it("uses an injected drain instead of the process one when given", async () => {
    const { redis } = scriptedRedis()
    const controller = new AbortController()
    const drain: StageJournalDrain = { isDraining: () => controller.signal.aborted, signal: () => controller.signal }
    const journal = createStageJournal(redis, async () => {}, drain)

    beginWorkerDrain() // the process drain is irrelevant to this journal
    expect((await journal.claim(key(), 60_000, { handOffOnDrain: true })).status).toBe("claimed")
    controller.abort()
    await expect(journal.claim(key(), 60_000, { handOffOnDrain: true })).rejects.toBeInstanceOf(DrainAbortError)
  })
})

// The same two shapes against the real journal script, in an isolated Redis when
// the binary is installed. No production REDIS_URL is read.
const hasRedis = spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0
describe.skipIf(!hasRedis)("stage journal drain — what the successor finds (real Redis)", () => {
  let directory: string
  let child: ChildProcess
  let redis: IORedis

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "stage-journal-drain-"))
    child = spawn("redis-server", ["--port", "0", "--unixsocket", path.join(directory, "redis.sock"),
      "--dir", directory, "--save", "", "--appendonly", "yes", "--appendfsync", "always"], { stdio: "ignore" })
    redis = new IORedis(path.join(directory, "redis.sock"), { retryStrategy: (attempt) => attempt < 40 ? 50 : null })
    redis.on("error", () => { /* Socket may not exist until Redis has started. */ })
    await new Promise<void>((resolve, reject) => {
      redis.once("ready", resolve)
      redis.once("end", () => reject(new Error("Test Redis did not start")))
      child.once("error", reject)
    })
  })

  afterAll(async () => {
    redis?.disconnect()
    if (child) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
      child.kill("SIGTERM")
      await exited
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  /** A worker's view of the journal, with its own drain flag. */
  function worker() {
    let draining = false
    const controller = new AbortController()
    const journal = createStageJournal(redis, async () => {},
      { isDraining: () => draining, signal: () => controller.signal })
    return { journal, sigterm: () => { draining = true; controller.abort(new DrainAbortError()) } }
  }

  const stageKey = (jobId: string, userId: string, stage: string): PluginStageKey =>
    ({ jobId, userId, attemptIndex: 0, stage, inputHash: "b".repeat(64), engineVersion: "1.0.0" })

  it("a stage in flight at SIGTERM finishes, the next boundary hands off, and the successor replays and resumes cleanly", async () => {
    const jobId = randomUUID(), userId = randomUUID()
    const planning = stageKey(jobId, userId, "planning")
    const review = stageKey(jobId, userId, "review")
    const dying = worker()

    const claim = await dying.journal.claim(planning, 5_000, { handOffOnDrain: true })
    if (claim.status !== "claimed") throw new Error("expected a claim")
    // The invocation marker a metered stage writes before it pays.
    expect(await dying.journal.checkpoint(planning, claim.lease, { invoked: true, receipt: null })).toBe(true)

    dying.sigterm() // the paid call is out; the drain lets it finish
    expect(await dying.journal.complete(planning, claim.lease, { artifactId: "plan-1" })).toBe(true)
    // The runner's `finally` release: a completed row has no lease left to drop,
    // so it answers false — and the runner ignores that answer by design.
    expect(await dying.journal.release(planning, claim.lease)).toBe(false)
    await expect(dying.journal.claim(review, 5_000, { handOffOnDrain: true })).rejects.toBeInstanceOf(DrainAbortError)

    const successor = worker()
    // The finished stage replays for free — no ambiguity.
    expect(await successor.journal.claim(planning, 5_000, { handOffOnDrain: true }))
      .toEqual({ status: "completed", output: { artifactId: "plan-1" } })
    // The stage that was never opened is opened fresh, with no marker to refuse.
    const reopened = await successor.journal.claim(review, 5_000, { handOffOnDrain: true })
    expect(reopened.status).toBe("claimed")
    expect(reopened.status === "claimed" && reopened.checkpoint).toBeNull()
  })

  it("control — a process killed mid-call leaves the marker the successor must refuse (the 2026-09-15 failure)", async () => {
    const jobId = randomUUID(), userId = randomUUID()
    const planning = stageKey(jobId, userId, "planning")
    const killed = worker()

    const claim = await killed.journal.claim(planning, 1_000, { handOffOnDrain: true })
    if (claim.status !== "claimed") throw new Error("expected a claim")
    await killed.journal.checkpoint(planning, claim.lease, { invoked: true, receipt: null })
    // SIGKILL: no complete, no release. The lease runs out on Redis' clock.
    await new Promise((resolve) => setTimeout(resolve, 1_150))

    const successor = worker()
    const found = await successor.journal.claim(planning, 5_000, { handOffOnDrain: true })
    expect(found.status).toBe("claimed")
    expect(found.status === "claimed" && found.checkpoint).toEqual({ invoked: true, receipt: null })
  })
})
