import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The publish / share / save gate looks at the graph the RUN will execute,
 * which includes every sub-workflow the graph reaches. A plain credential on
 * a Webhook Output inside a child used to pass publish and then fail at 3 a.m.
 * with `unbound_shared_run` — the exact failure the gate exists to prevent.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const findMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/http-credentials.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http-credentials.js")>()
  return { ...actual, findUnboundCredentialUses: findMock }
})

import { graphNeedsCredentialGate, graphWithSubWorkflows, unboundCredentialUsesFor } from "../credential-gate.js"
import { supabase } from "../supabase.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const CHILD = "00000000-0000-4000-8000-000000000c01"
const GRANDCHILD = "00000000-0000-4000-8000-000000000c02"
const CRED = "00000000-0000-4000-8000-0000000000e1"

type Node = { id: string; type?: string; data?: Record<string, unknown> }

const hook = (id: string, url = "https://hooks.example.com/in/x"): Node => ({
  id,
  type: "webhook-output",
  data: { url, credentialId: CRED },
})
const sub = (id: string, workflowId: string): Node => ({ id, type: "sub-workflow", data: { workflowId } })

/** `workflows` rows by id; records every (id, user_id) the walk asked for. */
function children(byId: Record<string, Node[]>, edgesById: Record<string, unknown[]> = {}) {
  const reads: Array<[string, string]> = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table !== "workflows") throw new Error(`unexpected table ${table}`)
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn((_c1: string, id: string) => ({
          eq: vi.fn((_c2: string, userId: string) => ({
            maybeSingle: vi.fn(async () => {
              reads.push([id, userId])
              return { data: byId[id] ? { nodes: byId[id], edges: edgesById[id] ?? [] } : null, error: null }
            }),
          })),
        })),
      }),
    }
  }) as never)
  return reads
}

beforeEach(() => {
  vi.clearAllMocks()
  // Echo: every credentialed webhook it is handed becomes one use.
  findMock.mockImplementation(async (nodes: ReadonlyArray<Node>, _owner: string, edges?: ReadonlyArray<{ target?: unknown; targetHandle?: unknown }>) =>
    nodes
      .filter((n) => n.type === "webhook-output" && typeof n.data?.credentialId === "string")
      .map((n) => ({
        nodeId: n.id,
        nodeLabel: "Webhook Output",
        credentialId: CRED,
        nodeUrl: String(n.data?.url ?? ""),
        kind: "plain",
        credentialName: "k",
        ...((edges ?? []).some((e) => e.target === n.id && e.targetHandle === "field-url") ? { urlMapped: true } : {}),
      })),
  )
})

describe("graphNeedsCredentialGate — the one pre-filter", () => {
  it("is true for a credentialed webhook or a sub-workflow, false otherwise", () => {
    expect(graphNeedsCredentialGate([hook("h")])).toBe(true)
    expect(graphNeedsCredentialGate([sub("s", CHILD)])).toBe(true)
    expect(graphNeedsCredentialGate([{ id: "h", type: "webhook-output", data: { url: "https://x.example/" } }, { id: "t", type: "text-prompt" }])).toBe(false)
    expect(graphNeedsCredentialGate(undefined)).toBe(false)
  })
})

describe("graphWithSubWorkflows", () => {
  it("reads each child once, as the owner, stops at a cycle, and carries the children's edges", async () => {
    const reads = children(
      {
        [CHILD]: [hook("child-hook"), sub("back-to-child", CHILD), sub("to-grandchild", GRANDCHILD)],
        [GRANDCHILD]: [hook("grandchild-hook"), sub("back-to-child-again", CHILD)],
      },
      { [CHILD]: [{ source: "x", target: "child-hook", targetHandle: "field-url" }] },
    )

    const graph = await graphWithSubWorkflows(
      [{ id: "t", type: "text-prompt" }, sub("s1", CHILD), sub("s1-again", CHILD)],
      [{ source: "t", target: "s1", targetHandle: "in" }],
      OWNER,
    )

    // Children are renamed into their own namespace; the parent keeps bare ids.
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "t", "s1",
      `${CHILD}:child-hook`, `${CHILD}:back-to-child`, `${CHILD}:to-grandchild`,
      `${GRANDCHILD}:grandchild-hook`, `${GRANDCHILD}:back-to-child-again`,
      "s1-again",
    ])
    expect(graph.edges).toEqual([
      { source: "t", target: "s1", targetHandle: "in" },
      { source: `${CHILD}:x`, target: `${CHILD}:child-hook`, targetHandle: "field-url" },
    ])
    expect(reads).toEqual([[CHILD, OWNER], [GRANDCHILD, OWNER]])
  })

  it("is depth-capped at the executor's limit: a longer chain is not followed further", async () => {
    const byId: Record<string, Node[]> = {}
    for (let i = 1; i <= 8; i++) byId[`wf-${i}`] = [sub(`s-${i + 1}`, `wf-${i + 1}`)]
    const reads = children(byId)

    await graphWithSubWorkflows([sub("s-1", "wf-1")], [], OWNER)

    expect(reads.length).toBe(5)
  })

  it("a child that is not the owner's (or is gone) contributes nothing", async () => {
    const reads = children({})
    const graph = await graphWithSubWorkflows([sub("s1", CHILD)], undefined, OWNER)
    expect(graph.nodes.map((n) => n.id)).toEqual(["s1"])
    expect(graph.edges).toEqual([])
    expect(reads).toEqual([[CHILD, OWNER]])
  })
})

describe("unboundCredentialUsesFor", () => {
  it("a plain credential inside a sub-workflow is judged at the same door as one on the parent", async () => {
    children({ [CHILD]: [hook("child-hook", "https://hooks.example.com/in/child")] })

    const uses = await unboundCredentialUsesFor([sub("s1", CHILD)], OWNER)

    expect(uses.map((u) => u.nodeId)).toEqual([`${CHILD}:child-hook`])
    expect(findMock).toHaveBeenCalledTimes(1)
  })

  it("a child's field-url edge never marks a same-id PARENT node as mapped", async () => {
    // The child reuses the parent's node id "hook" (a duplicated workflow used as a child does).
    children({ [CHILD]: [hook("hook")] }, { [CHILD]: [{ source: "x", target: "hook", targetHandle: "field-url" }] })
    const uses = await unboundCredentialUsesFor([hook("hook"), sub("s1", CHILD)], OWNER)
    expect(uses.map((u) => [u.nodeId, u.urlMapped === true])).toEqual([["hook", false], [`${CHILD}:hook`, true]])
  })

  it("a graph with neither a credentialed webhook nor a sub-workflow costs nothing — no read, no finder", async () => {
    children({})
    const uses = await unboundCredentialUsesFor([{ id: "t", type: "text-prompt" }, { id: "h", type: "webhook-output", data: { url: "https://x.example/" } }], OWNER)
    expect(uses).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
  })

  it("a sub-workflow tree without any credentialed webhook reads the children but never calls the finder", async () => {
    children({ [CHILD]: [{ id: "c-text", type: "text-prompt" }] })
    const uses = await unboundCredentialUsesFor([sub("s1", CHILD)], OWNER)
    expect(uses).toEqual([])
    expect(findMock).not.toHaveBeenCalled()
  })

  it("parent and child uses are reported together", async () => {
    children({ [CHILD]: [hook("child-hook")] })
    const uses = await unboundCredentialUsesFor([hook("parent-hook"), sub("s1", CHILD)], OWNER)
    expect(uses.map((u) => u.nodeId)).toEqual(["parent-hook", `${CHILD}:child-hook`])
  })

  it("edges reach the finder — the parent's and the children's — so a mapped URL is known", async () => {
    children({ [CHILD]: [hook("child-hook")] }, { [CHILD]: [{ source: "x", target: "child-hook", targetHandle: "field-url" }] })
    const uses = await unboundCredentialUsesFor(
      [hook("parent-hook"), sub("s1", CHILD)],
      OWNER,
      [{ source: "y", target: "parent-hook", targetHandle: "field-url" }],
    )
    expect(uses.map((u) => [u.nodeId, u.urlMapped === true])).toEqual([["parent-hook", true], [`${CHILD}:child-hook`, true]])
  })
})
