/**
 * The override lock at the orchestrator (issue #1555) — REAL
 * `processWorkflowExecution` path.
 *
 * The five routes answer 400 first, but the invariant is
 * the merge: `applyInputOverridesToNodes` throws `LockedOverrideError` before
 * touching a node, and the orchestrator's outer catch turns that into a FAILED
 * execution carrying the message. This pins the second half — that the throw
 * reaches the catch (nothing between the merge and the catch swallows it), that
 * no node is dispatched, and that the row's `error_message` names the field and
 * the node and never the value.
 *
 * Harness: the leaf I/O is mocked (supabase, executeNode, reconcile / write
 * helpers); seeding, override application and level building run for real —
 * the same shape as `freeze-lottie-override.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNode = vi.fn(async () => ({ output: { text: "x" }, creditsUsed: 0 }))
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  let workflowRow: Record<string, unknown> | null = null
  const execSelectRow = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states")
        return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => makeChain(table, columns).select(columns),
    update: () => makeChain(table).update(),
    insert: () => makeChain(table).insert(),
  }))

  return {
    executeNode,
    updateExecutionWithRetry,
    from,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    ORCHESTRATOR_CONCURRENCY: 2,
    MAX_CONCURRENT_NODES_PER_EXECUTION: 12,
  },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))

vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: mocks.updateExecutionWithRetry,
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

function makeJob(inputOverrides: Record<string, Record<string, unknown>>): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
      { id: "hook-1", type: "webhook-output", data: { url: "https://owner.example/hook" } },
    ],
    edges: [{ id: "e1", source: "text-1", target: "hook-1" }],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: "viewer-1",
      triggerType: "manual",
      inputOverrides,
    },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    (c) => (c[1] as Record<string, unknown> | undefined)?.status === "failed",
  )
  return call?.[1] as Record<string, unknown> | undefined
}

describe("orchestrator — a locked override fails the execution before any node runs", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.updateExecutionWithRetry.mockClear()
  })

  it("fails the execution with the lock's message and dispatches nothing", async () => {
    await processWorkflowExecution(makeJob({ "hook-1": { url: "https://attacker.example/collect" } }))

    expect(mocks.executeNode).not.toHaveBeenCalled()
    const write = failedWrite()
    expect(write, "the execution row should have been marked failed").toBeDefined()
    const message = String(write!.error_message)
    expect(message).toContain('"url" on webhook-output node "hook-1"')
    expect(message).not.toContain("attacker")
    expect(message).not.toContain("owner.example")
  })

  it("an ordinary override runs the graph as usual", async () => {
    await processWorkflowExecution(makeJob({ "text-1": { text: "a legitimate input" } }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNode).toHaveBeenCalled()
  })
})
