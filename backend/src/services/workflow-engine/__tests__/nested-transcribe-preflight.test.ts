/**
 * THE NESTED half of the pre-run word-timings refusal.
 *
 * A `whisper` transcript feeding add-captions can only end one way: the
 * transcription runs, bills, and the captions node then fails on the empty word
 * list. The orchestrator refuses that up front — but its check saw only the
 * parent graph, so the same chain INSIDE a sub-workflow was refused when the
 * sub-workflow node's turn came, after the parent's upstream nodes had run and
 * billed.
 *
 * `findNestedWordlessTranscriptFeeds` closes that: it walks every graph a
 * `sub-workflow` node in the run set will execute, loading each one through the
 * SAME loader `executeSubWorkflow` uses, and mirrors the executor's depth
 * ceiling and cycle key. These tests pin the walk itself — which graphs it
 * loads, how it scopes the load, and the three ways it must answer "no hit"
 * rather than refuse a run it cannot judge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SimpleNode, SimpleEdge } from "../types.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "../types.js"

// ---------------------------------------------------------------------------
// Mocks — the workflows table, keyed by id, plus the recorded scoping.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const rows = new Map<string, { nodes: unknown; edges: unknown; user_id: string }>()
  /** Every `workflows` load the code under test made, with its owner scoping. */
  const loads: Array<{ id: unknown; userId: unknown }> = []
  let throwOnLoad = false

  const from = vi.fn((table: string) => ({
    select: () => {
      const filters: Record<string, unknown> = {}
      const chain = {
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        single: async () => {
          if (table !== "workflows") return { data: null, error: { message: "unexpected table" } }
          loads.push({ id: filters.id, userId: filters.user_id })
          if (throwOnLoad) throw new Error("connection reset")
          const row = rows.get(filters.id as string)
          if (!row || row.user_id !== filters.user_id) return { data: null, error: { message: "not found" } }
          return { data: { nodes: row.nodes, edges: row.edges }, error: null }
        },
      }
      return chain
    },
  }))

  return {
    from,
    loads,
    rows,
    setThrowOnLoad: (v: boolean) => {
      throwOnLoad = v
    },
  }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

// Keeps BullMQ (and the rest of the executor chain) out of this suite.
vi.mock("../node-executor.js", () => ({
  executeNode: vi.fn().mockResolvedValue({ output: {} }),
}))

import { findNestedWordlessTranscriptFeeds, nestedWordlessFeedMessage } from "../sub-workflow-handler.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = "owner-1"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function subWorkflowNode(id: string, workflowId: string, data: Record<string, unknown> = {}): SimpleNode {
  return node(id, "sub-workflow", { workflowId, ...data })
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

/** transcribe(provider) --json--> add-captions.transcript */
function captionChain(provider: string, suffix = ""): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const tr = `tr${suffix}`
  const ac = `ac${suffix}`
  return {
    nodes: [node(tr, "transcribe", { provider }), node(ac, "add-captions", { style: "karaoke" })],
    edges: [edge(tr, ac, "json", "transcript")],
  }
}

/** Register a referenced workflow row owned by OWNER unless told otherwise. */
function workflow(id: string, graph: { nodes: SimpleNode[]; edges: SimpleEdge[] }, ownerId = OWNER) {
  mocks.rows.set(id, { nodes: graph.nodes, edges: graph.edges, user_id: ownerId })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findNestedWordlessTranscriptFeeds", () => {
  beforeEach(() => {
    mocks.rows.clear()
    mocks.loads.length = 0
    mocks.from.mockClear()
    mocks.setThrowOnLoad(false)
  })

  it("finds a word-less chain one level down and names the sub-workflow path", async () => {
    workflow("wf-child", captionChain("whisper"))
    const parent = [node("gv1", "generate-video"), subWorkflowNode("sw1", "wf-child")]

    const hits = await findNestedWordlessTranscriptFeeds(parent, [edge("gv1", "sw1")], OWNER)

    expect(hits).toHaveLength(1)
    expect(hits[0].subWorkflowPath).toEqual(["sw1"])
    expect(hits[0].transcribeNodeId).toBe("tr")
    expect(hits[0].consumerNodeId).toBe("ac")
    const message = nestedWordlessFeedMessage(hits[0])
    expect(message).toMatch(/word timings/)
    expect(message).toContain("Sub-workflow node sw1")
    expect(message).toContain("Transcribe node tr")
    expect(message).toContain("Add Captions node ac")
  })

  it("scopes every nested load to the workflow OWNER (the IDOR seam the executor uses)", async () => {
    // The row exists but belongs to someone else: the load must come back empty,
    // exactly as it would for the run, so the preflight reports no hit.
    workflow("wf-child", captionChain("whisper"), "someone-else")
    const parent = [subWorkflowNode("sw1", "wf-child")]

    const hits = await findNestedWordlessTranscriptFeeds(parent, [], OWNER)

    expect(hits).toEqual([])
    expect(mocks.loads).toEqual([{ id: "wf-child", userId: OWNER }])
  })

  it("walks two levels down", async () => {
    workflow("wf-mid", { nodes: [subWorkflowNode("sw2", "wf-leaf")], edges: [] })
    workflow("wf-leaf", captionChain("whisper", "-leaf"))

    const hits = await findNestedWordlessTranscriptFeeds([subWorkflowNode("sw1", "wf-mid")], [], OWNER)

    expect(hits).toHaveLength(1)
    expect(hits[0].subWorkflowPath).toEqual(["sw1", "sw2"])
    expect(hits[0].transcribeNodeId).toBe("tr-leaf")
  })

  it("does not loop on a cyclic reference, and still reports the hit it found", async () => {
    // A ⊃ sw→B, B ⊃ sw→A (plus a word-less chain in B). The runtime cycle guard
    // starts empty too, so B loads A once as a child and stops there.
    workflow("wf-a", { nodes: [subWorkflowNode("sw-b", "wf-b")], edges: [] })
    workflow("wf-b", {
      nodes: [subWorkflowNode("sw-a", "wf-a"), ...captionChain("whisper").nodes],
      edges: captionChain("whisper").edges,
    })

    const hits = await findNestedWordlessTranscriptFeeds([subWorkflowNode("sw1", "wf-a")], [], OWNER)

    expect(hits).toHaveLength(1)
    expect(hits[0].subWorkflowPath).toEqual(["sw1", "sw-b"])
    // wf-a (via sw1), wf-b (via sw-b) — and then sw-a's route key is already on
    // the path, so the walk stops instead of recursing forever. The run stops
    // there too: executeSubWorkflow throws "Cycle detected" on that same key.
    expect(mocks.loads.map((l) => l.id)).toEqual(["wf-a", "wf-b"])
  })

  it("ignores a reference that cannot be loaded — the run raises its own not-found", async () => {
    const hits = await findNestedWordlessTranscriptFeeds([subWorkflowNode("sw1", "wf-missing")], [], OWNER)
    expect(hits).toEqual([])
  })

  it("ignores a sub-workflow node with no reference at all", async () => {
    const hits = await findNestedWordlessTranscriptFeeds([node("sw1", "sub-workflow", {})], [], OWNER)
    expect(hits).toEqual([])
    expect(mocks.loads).toEqual([])
  })

  it("ignores a load that THROWS — this check may only refuse for a real hit", async () => {
    workflow("wf-child", captionChain("whisper"))
    mocks.setThrowOnLoad(true)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const hits = await findNestedWordlessTranscriptFeeds([subWorkflowNode("sw1", "wf-child")], [], OWNER)

    expect(hits).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("passes a clean nested graph (a lane that CAN return word timings)", async () => {
    workflow("wf-child", captionChain("elevenlabs-stt"))
    const hits = await findNestedWordlessTranscriptFeeds([subWorkflowNode("sw1", "wf-child")], [], OWNER)
    expect(hits).toEqual([])
  })

  it("ignores a SKIPPED sub-workflow node (it never runs)", async () => {
    workflow("wf-child", captionChain("whisper"))
    const hits = await findNestedWordlessTranscriptFeeds(
      [subWorkflowNode("sw1", "wf-child", { skipped: true })],
      [],
      OWNER,
    )
    expect(hits).toEqual([])
    expect(mocks.loads).toEqual([])
  })

  it("sees only the nodes the ROUTE will run (same reachability filter as the executor)", async () => {
    // The word-less chain sits outside the selected route, so the run never
    // executes it — and the preflight must not refuse for it.
    workflow("wf-child", {
      nodes: [
        node("in", "sub-workflow-input"),
        node("out", "sub-workflow-output"),
        ...captionChain("whisper").nodes,
      ],
      edges: [edge("in", "out"), ...captionChain("whisper").edges],
    })

    const hits = await findNestedWordlessTranscriptFeeds(
      [subWorkflowNode("sw1", "wf-child", { routeSnapshot: { inputNodeId: "in", outputNodeId: "out" } })],
      [],
      OWNER,
    )

    expect(hits).toEqual([])
  })

  it("stops at the executor's depth ceiling", async () => {
    workflow("wf-child", captionChain("whisper"))
    const hits = await findNestedWordlessTranscriptFeeds(
      [subWorkflowNode("sw1", "wf-child")],
      [],
      OWNER,
      MAX_SUB_WORKFLOW_DEPTH,
    )
    // At this depth the node throws the depth-limit error instead of running, so
    // there is nothing below it to judge.
    expect(hits).toEqual([])
    expect(mocks.loads).toEqual([])
  })

  it("descends only — a word-less chain in the caller's OWN graph is the caller's check", async () => {
    const hits = await findNestedWordlessTranscriptFeeds(
      captionChain("whisper").nodes,
      captionChain("whisper").edges,
      OWNER,
    )
    expect(hits).toEqual([])
  })
})
