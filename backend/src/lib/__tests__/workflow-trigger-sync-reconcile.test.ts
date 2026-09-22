/**
 * `reconcileWorkflowTriggers` against the table: a CREATED row carries
 * `owner_initiated: true` only when the caller vouched for THAT node id, an
 * existing row is never re-stamped, vouched and plain rows go in separate
 * inserts (one key set per PostgREST batch), and a database that does not
 * have the column yet gets the vouched rows again without it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { reconcileWorkflowTriggers } from "../workflow-trigger-sync.js"
import { supabase } from "../supabase.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

const schedule = (id: string) => ({ id, type: "schedule-trigger", data: { interval: "*/5 * * * *", cron: "*/5 * * * *" } })

/**
 * `workflow_triggers`: `existing` answers the list read; every insert's rows
 * are recorded, and the first `insertErrors.length` inserts fail in order.
 */
function table(existing: Array<Record<string, unknown>>, insertErrors: Array<{ code: string; message: string } | null> = []) {
  const inserts: Array<Array<Record<string, unknown>>> = []
  const updates: Array<Record<string, unknown>> = []
  let insertCall = 0
  vi.mocked(supabase.from).mockImplementation(((tableName: string) => {
    if (tableName !== "workflow_triggers") throw new Error(`unexpected table ${tableName}`)
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "delete"]) chain[m] = vi.fn(() => chain)
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch)
      return chain
    })
    chain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
      inserts.push(rows)
      const err = insertErrors[insertCall++] ?? null
      return { then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: err }) }
    })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: existing, error: null })
    return chain
  }) as never)
  return { inserts, updates }
}

beforeEach(() => vi.clearAllMocks())

describe("reconcileWorkflowTriggers — provenance on the rows it creates", () => {
  it("a vouched node id (the owner's session says it just added it) creates the row owner-initiated", async () => {
    const { inserts } = table([])
    const result = await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [schedule("s1")], vouchNodeIds: ["s1"] })
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 })
    expect(inserts).toHaveLength(1)
    expect(inserts[0][0]).toMatchObject({ workflow_id: WF, user_id: OWNER, type: "schedule", owner_initiated: true })
    expect(inserts[0][0].config).toMatchObject({ cron: "*/5 * * * *", nodeId: "s1" })
  })

  it("no vouch (an API or MCP graph write) creates the row without the column at all", async () => {
    const { inserts } = table([])
    await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [schedule("s1")] })
    expect(inserts).toHaveLength(1)
    expect(inserts[0][0]).not.toHaveProperty("owner_initiated")
  })

  it("a vouch names ids: the node that was already in the graph is created plain, the added one vouched — two inserts", async () => {
    const { inserts } = table([])
    const result = await reconcileWorkflowTriggers({
      workflowId: WF,
      userId: OWNER,
      nodes: [schedule("planted-by-token"), schedule("mine")],
      vouchNodeIds: ["mine"],
    })
    expect(result).toEqual({ created: 2, updated: 0, removed: 0 })
    expect(inserts).toHaveLength(2)
    const plain = inserts.find((rows) => rows.some((r) => (r.config as { nodeId: string }).nodeId === "planted-by-token"))!
    const vouched = inserts.find((rows) => rows.some((r) => (r.config as { nodeId: string }).nodeId === "mine"))!
    expect(plain[0]).not.toHaveProperty("owner_initiated")
    expect(vouched[0]).toHaveProperty("owner_initiated", true)
  })

  it("an existing row is updated in place and never re-stamped, whatever the vouch says", async () => {
    const { inserts, updates } = table([
      { id: "row-1", type: "schedule", config: { cron: "0 * * * *", nodeId: "s1" }, is_active: true },
    ])
    const result = await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [schedule("s1")], vouchNodeIds: ["s1"] })
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 })
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0]).not.toHaveProperty("owner_initiated")
  })

  it("a database without the column yet (migration 436 not landed) gets the vouched rows again without it", async () => {
    const { inserts } = table([], [{ code: "PGRST204", message: "Could not find the 'owner_initiated' column" }])
    const result = await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [schedule("s1")], vouchNodeIds: ["s1"] })
    expect(result).toEqual({ created: 1, updated: 0, removed: 0 })
    expect(inserts).toHaveLength(2)
    expect(inserts[0][0]).toHaveProperty("owner_initiated", true)
    expect(inserts[1][0]).not.toHaveProperty("owner_initiated")
  })

  it("any other insert failure is reported, not retried", async () => {
    const { inserts } = table([], [{ code: "23503", message: "fk" }])
    const result = await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [schedule("s1")], vouchNodeIds: ["s1"] })
    expect(result.error).toBe("fk")
    expect(inserts).toHaveLength(1)
  })
})
