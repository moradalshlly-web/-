/**
 * A TRIGGERED run executes the branch behind its trigger — REAL orchestrator path.
 *
 * `triggerRunScope` is pinned as a pure function in execution-graph.test.ts;
 * this drives the real `processWorkflowExecution` to pin the WIRING: the
 * scope is computed from the stored graph before any node runs, an explicit
 * subset ("run from here") wins over it, and a manual run is never scoped.
 * Only leaf I/O is mocked, so what is asserted is which nodes were dispatched.
 *
 * Harness mirrors transcribe-preflight-orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { imageUrl: "https://x.png" }, creditsUsed: 0 }
  })

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
    executeNodeCalls,
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two branches: `sched --> a` behind the Schedule Trigger, and `other --> b`
 * the trigger never reaches. `other` is a source node (no execution), so the
 * executable nodes are exactly `a` and `b`.
 */
function makeJob(job: Partial<WorkflowExecutionJob>): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "sched", type: "schedule-trigger", data: { label: "Schedule", interval: "1h" } },
      { id: "a", type: "generate-image", data: { label: "a", prompt: "a cat" } },
      { id: "other", type: "text-prompt", data: { label: "other", text: "a dog" } },
      { id: "b", type: "generate-image", data: { label: "b", prompt: "a dog" } },
    ],
    edges: [
      { id: "e1", source: "sched", target: "a", sourceHandle: null, targetHandle: null },
      { id: "e2", source: "other", target: "b", sourceHandle: "text", targetHandle: "prompt" },
    ],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "manual",
      ...job,
    },
  } as unknown as Job<WorkflowExecutionJob>
}

/** The terminal write failExecution makes (status "failed" + error_message). */
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

const dispatched = () => [...mocks.executeNodeCalls].sort()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orchestrator — a triggered run executes the branch behind its trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeCalls.length = 0
  })

  it("a schedule fire runs the trigger's branch only — the other branch is left alone", async () => {
    await processWorkflowExecution(makeJob({ triggerType: "schedule", triggerNodeId: "sched" }))
    expect(dispatched()).toEqual(["a"])
    expect(failedWrite()).toBeUndefined()
  })

  it("a schedule row that names no node still finds the only Schedule Trigger on the graph", async () => {
    await processWorkflowExecution(makeJob({ triggerType: "schedule" }))
    expect(dispatched()).toEqual(["a"])
  })

  it("a manual run is never scoped by a trigger", async () => {
    await processWorkflowExecution(makeJob({ triggerType: "manual" }))
    expect(dispatched()).toEqual(["a", "b"])
    expect(failedWrite()).toBeUndefined()
  })

  it("an explicit subset (run from here / run selected) wins over the trigger's scope", async () => {
    await processWorkflowExecution(makeJob({ triggerType: "schedule", triggerNodeId: "sched", nodeIds: ["b"] }))
    expect(dispatched()).toEqual(["b"])
  })
})
