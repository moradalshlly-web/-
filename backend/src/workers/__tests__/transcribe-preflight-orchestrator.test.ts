/**
 * THE PRE-RUN REFUSAL for a transcription that cannot feed the captions it is
 * wired to — REAL orchestrator path.
 *
 * `whisper` has no word-timestamps capability at all: it RUNS, it BILLS, and it
 * hands back phrase segments with `words: []`. Wire its `json` output into an
 * add-captions `transcript` input and the run can only end one way — the
 * transcribe node completes and charges, then the captions node fails on the
 * empty word list. The user pays for a run that was impossible from the start.
 *
 * So the orchestrator refuses the whole execution BEFORE any node runs or
 * reserves a credit, at the same seam the catalog wall uses (the one place
 * every run passes with its graph in hand). These tests drive the REAL
 * `processWorkflowExecution` — real node seeding, real level build, real
 * executable filter — with only leaf I/O mocked, so they assert BEHAVIOR:
 * nothing was dispatched, and the execution row was failed with a message that
 * names the nodes.
 *
 * Harness mirrors freeze-lottie-override.test.ts.
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

/** transcribe --json--> add-captions.transcript, on the given lane. */
function makeJob(opts: {
  provider?: string
  skipped?: boolean
  nodeIds?: string[]
  captionsTargetHandle?: string
} = {}): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "up1", type: "upload-video", data: { videoUrl: "https://v.mp4" } },
      {
        id: "tr1",
        type: "transcribe",
        data: { audioUrl: "https://v.mp4", ...(opts.provider ? { provider: opts.provider } : {}), ...(opts.skipped ? { skipped: true } : {}) },
      },
      { id: "ac1", type: "add-captions", data: { videoUrl: "https://v.mp4", style: "karaoke" } },
    ],
    edges: [
      { id: "e1", source: "up1", target: "tr1", sourceHandle: "video", targetHandle: "audio" },
      { id: "e2", source: "tr1", target: "ac1", sourceHandle: "json", targetHandle: opts.captionsTargetHandle ?? "transcript" },
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
      ...(opts.nodeIds ? { nodeIds: opts.nodeIds } : {}),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orchestrator pre-run check — a word-less transcript feeding captions", () => {
  beforeEach(() => {
    mocks.executeNode.mockClear()
    mocks.executeNodeCalls.length = 0
    mocks.updateExecutionWithRetry.mockClear()
  })

  it("refuses the execution before ANY node runs, naming both nodes", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper" }))

    // Nothing was dispatched — so nothing reserved a credit either.
    expect(mocks.executeNodeCalls).toEqual([])
    const failed = failedWrite()
    expect(failed, "the execution row must be failed, not left running").toBeDefined()
    expect(failed!.error_message).toMatch(/word timings/)
    expect(failed!.error_message).toContain("tr1")
    expect(failed!.error_message).toContain("ac1")
  })

  it("runs normally on a lane that CAN return word timings", async () => {
    await processWorkflowExecution(makeJob({ provider: "elevenlabs-stt" }))

    expect(mocks.executeNodeCalls).toContain("tr1")
    expect(failedWrite()).toBeUndefined()
  })

  it("ignores a SKIPPED transcribe node (it never re-transcribes)", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper", skipped: true }))

    expect(failedWrite()).toBeUndefined()
  })

  it("ignores a transcribe node OUTSIDE a partial-run subset (it is pre-completed from its saved output)", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper", nodeIds: ["ac1"] }))

    expect(failedWrite()).toBeUndefined()
  })

  it("does not fire when the json output feeds something that is not a transcript input", async () => {
    await processWorkflowExecution(makeJob({ provider: "whisper", captionsTargetHandle: "captions" }))

    expect(failedWrite()).toBeUndefined()
  })
})
