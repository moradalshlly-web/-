/**
 * THE PRE-RUN REFUSAL, NESTED — REAL orchestrator path.
 *
 * A `whisper` transcript wired into add-captions can only end one way: the
 * transcription runs and bills, then the captions node fails on the empty word
 * list. The orchestrator refuses that before any node runs — but its check saw
 * only the parent graph, so the same chain inside a SUB-WORKFLOW was refused
 * when the sub-workflow node's turn came, i.e. after the parent's upstream nodes
 * had executed and charged. "The run does not start: nothing executes and
 * nothing is billed" was not true for a nested graph.
 *
 * These tests drive the REAL `processWorkflowExecution` with only leaf I/O
 * mocked, so they assert BEHAVIOR: nothing was dispatched, and the execution row
 * was failed with a message that names the path to the offending pair.
 *
 * Harness mirrors transcribe-preflight-orchestrator.test.ts, with a `workflows`
 * table keyed by id (the nested load is a second, owner-scoped read).
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
    return { output: { text: "x" }, creditsUsed: 0 }
  })

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  /** The `workflows` table: id → row. The parent and every referenced graph. */
  const workflows = new Map<string, Record<string, unknown>>()
  /** Owner scoping of each nested (`nodes, edges`) load. */
  const nestedLoads: Array<{ id: unknown; userId: unknown }> = []
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        if (columns === "nodes, edges") nestedLoads.push({ id: filters.id, userId: filters.user_id })
        const row = workflows.get(filters.id as string)
        if (!row) return { data: null, error: { message: "nf" } }
        // The nested load is owner-scoped; an unscoped parent load has no filter.
        if (filters.user_id !== undefined && row.user_id !== filters.user_id) {
          return { data: null, error: { message: "nf" } }
        }
        return { data: row, error: null }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") {
        return { data: execSelectRow, error: null }
      }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  return { executeNode, executeNodeCalls, updateExecutionWithRetry, from, workflows, nestedLoads }
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

const OWNER = "owner-1"

/** transcribe(provider) --json--> add-captions.transcript, inside one graph. */
function captionChain(provider: string) {
  return {
    nodes: [
      { id: "tr1", type: "transcribe", data: { audioUrl: "https://v.mp4", provider } },
      { id: "ac1", type: "add-captions", data: { videoUrl: "https://v.mp4", style: "karaoke" } },
    ],
    edges: [{ id: "e-inner", source: "tr1", target: "ac1", sourceHandle: "json", targetHandle: "transcript" }],
  }
}

/**
 * Parent: generate-video → sub-workflow S. S holds the caption chain, so the
 * spend that must NOT happen is generate-video's.
 */
function makeJob(opts: { provider: string; nested?: boolean; ownerId?: string } = { provider: "whisper" }): Job<WorkflowExecutionJob> {
  const inner = captionChain(opts.provider)
  mocks.workflows.set("wf-parent", {
    nodes: [
      { id: "gv1", type: "generate-video", data: { prompt: "a cat" } },
      { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } },
    ],
    edges: [{ id: "e1", source: "gv1", target: "sw1", sourceHandle: null, targetHandle: null }],
    settings: {},
    user_id: OWNER,
  })
  mocks.workflows.set("wf-child", {
    nodes: opts.nested
      ? [{ id: "sw2", type: "sub-workflow", data: { workflowId: "wf-grandchild" } }]
      : inner.nodes,
    edges: opts.nested ? [] : inner.edges,
    user_id: opts.ownerId ?? OWNER,
  })
  mocks.workflows.set("wf-grandchild", { nodes: inner.nodes, edges: inner.edges, user_id: opts.ownerId ?? OWNER })

  return {
    data: { executionId: "exec-1", workflowId: "wf-parent", userId: OWNER, triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

/** The terminal write failExecution makes (status "failed" + error_message). */
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orchestrator pre-run check — a word-less transcript feeding captions INSIDE a sub-workflow", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
    mocks.workflows.clear()
    mocks.nestedLoads.length = 0
  })

  it("refuses before ANY node runs — the parent's generate-video never bills", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper" }))

    expect(mocks.executeNodeCalls, "nothing dispatched ⇒ nothing reserved").toEqual([])
    const failed = failedWrite()
    expect(failed, "the execution row must be failed, not left running").toBeDefined()
    expect(failed!.error_message).toMatch(/word timings/)
    // The path a user needs to find it: which sub-workflow node, which pair.
    expect(failed!.error_message).toContain("Sub-workflow node sw1")
    expect(failed!.error_message).toContain("tr1")
    expect(failed!.error_message).toContain("ac1")
  })

  it("names the whole path for a two-level nesting", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper", nested: true }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toContain("Sub-workflow node sw1 → sw2")
  })

  it("scopes the nested load to the workflow owner", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper" }))
    expect(mocks.nestedLoads).toEqual([{ id: "wf-child", userId: OWNER }])
  })

  it("runs normally when the nested lane CAN return word timings", async () => {
    await processWorkflowExecution(makeJob({ provider: "elevenlabs-stt" }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls).toContain("gv1")
    expect(mocks.executeNodeCalls).toContain("sw1")
  })

  it("lets the run raise its own error for a reference it cannot load", async () => {
    // A sub-workflow whose referenced graph belongs to someone else: the
    // preflight sees nothing (the load is empty for this owner) and the run
    // proceeds to fail at that node, exactly as it did before this check.
    await processWorkflowExecution(makeJob({ provider: "whisper", ownerId: "someone-else" }))

    const failed = failedWrite()
    expect(failed?.error_message ?? "").not.toMatch(/word timings/)
    expect(mocks.executeNodeCalls).toContain("gv1")
  })
})
