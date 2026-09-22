/**
 * Saving a workflow — the credential gate at SAVE time (plan D3).
 *
 * Share-for-run lets viewers run the LIVE graph, so the gate at share time is
 * not enough: an owner who shares first and attaches a plain credential later
 * would expose it. Both save branches refuse a plain / missing credential on a
 * Webhook Output when the workflow is already exposed (shared for run, or the
 * source of an active app) — and cost nothing when the save carries no
 * credentialed webhook node.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "webhook-output", category: "output" },
  ],
}))

const { findUnboundMock } = vi.hoisted(() => ({ findUnboundMock: vi.fn() }))
vi.mock("@/lib/http-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http-credentials.js")>()),
  findUnboundCredentialUses: findUnboundMock,
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const CRED = "00000000-0000-4000-8000-0000000000c1"

const CRED_HOOK = { id: "hook-1", type: "webhook-output", position: { x: 0, y: 0 }, data: { url: "https://mine.example/hook", credentialId: CRED } }
const PLAIN_HOOK = { id: "hook-2", type: "webhook-output", position: { x: 0, y: 0 }, data: { url: "https://mine.example/hook" } }
const USE = { nodeId: "hook-1", nodeLabel: "Webhook Output", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "plain" as const, credentialName: "Grok bot" }

/**
 * Serves the workflow row (with the given exposure) and an `published_apps`
 * count; records writes (update / rpc) so a refusal can be proven to precede them.
 */
function serve(opts: { shared: boolean; activeApps: number; visibility?: string }) {
  const row = {
    id: WORKFLOW_ID,
    project_id: null,
    user_id: OWNER,
    workspace_id: null,
    visibility: opts.visibility ?? "private",
    nodes: [],
    edges: [],
    settings: {},
    version: 1,
    updated_at: "2026-09-22T00:00:00.000Z",
    share_token: opts.shared ? "tok" : null,
    is_presentation_enabled: opts.shared,
  }
  const writes: string[] = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.update = vi.fn(() => {
      writes.push(`update:${table}`)
      return chain
    })
    const result = table === "workflows" ? { data: row, error: null } : { data: null, error: null }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(table === "published_apps" ? { data: null, count: opts.activeApps, error: null } : { data: [], error: null })
    return chain
  }) as never)
  vi.mocked(supabase.rpc).mockImplementation((async () => {
    writes.push("rpc")
    return { data: { ok: true, version: 2, updated_at: "2026-09-22T00:00:01.000Z" }, error: null }
  }) as never)
  return { writes }
}

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  findUnboundMock.mockReset()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const fullSave = (nodes: unknown[]) =>
  app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { nodes, edges: [BODY_EDGE] } })
const BODY_EDGE = { id: "e-body", source: "t1", target: "hook-1", targetHandle: "field-url" }
const deltaSave = (upsertNodes: unknown[], delta: Record<string, unknown> = {}) =>
  app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": OWNER }, payload: { delta: { baseVersion: 1, upsertNodes, ...delta } } })

describe("PATCH /v1/workflows/:id — a plain credential on an EXPOSED workflow", () => {
  it("full-body save: refused with 409 credential_unbound when shared for run, before the update", async () => {
    const { writes } = serve({ shared: true, activeApps: 0 })
    findUnboundMock.mockResolvedValue([USE])
    const res = await fullSave([CRED_HOOK])
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("credential_unbound")
    expect(findUnboundMock).toHaveBeenCalledWith([CRED_HOOK], OWNER, [BODY_EDGE])
    expect(writes.filter((w) => w.startsWith("update:workflows"))).toEqual([])
  })

  it("full-body save: refused when the workflow is behind an active published app", async () => {
    serve({ shared: false, activeApps: 1 })
    findUnboundMock.mockResolvedValue([USE])
    const res = await fullSave([CRED_HOOK])
    expect(res.statusCode).toBe(409)
  })

  it("delta save: refused the same way, before the RPC", async () => {
    const { writes } = serve({ shared: true, activeApps: 0 })
    findUnboundMock.mockResolvedValue([USE])
    const res = await deltaSave([CRED_HOOK])
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("credential_unbound")
    expect(writes).not.toContain("rpc")
  })
})

describe("PATCH /v1/workflows/:id — more exposure lanes, and no oracle", () => {
  it("a workspace-visible workflow counts as exposed", async () => {
    serve({ shared: false, activeApps: 0, visibility: "workspace" })
    findUnboundMock.mockResolvedValue([USE])
    const res = await fullSave([CRED_HOOK])
    expect(res.statusCode).toBe(409)
  })

  it("delta save by someone below edit gets the RPC's answer, never the gate's 409 (no existence / exposure oracle)", async () => {
    const STRANGER = "00000000-0000-4000-8000-000000000099"
    serve({ shared: true, activeApps: 1 })
    findUnboundMock.mockResolvedValue([USE])
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": STRANGER },
      payload: { delta: { baseVersion: 1, upsertNodes: [CRED_HOOK] } },
    })
    expect(res.statusCode).not.toBe(409)
    expect(findUnboundMock).not.toHaveBeenCalled()
  })
})

describe("PATCH /v1/workflows/:id — when the gate must stay silent", () => {
  it("an UNEXPOSED workflow may carry a plain credential — the vault is not even asked", async () => {
    serve({ shared: false, activeApps: 0 })
    const full = await fullSave([CRED_HOOK])
    expect(full.statusCode).not.toBe(409)
    const delta = await deltaSave([CRED_HOOK])
    expect(delta.statusCode).not.toBe(409)
    expect(findUnboundMock).not.toHaveBeenCalled()
  })

  it("a save without a credentialed webhook costs nothing on an exposed workflow", async () => {
    serve({ shared: true, activeApps: 1 })
    const res = await fullSave([PLAIN_HOOK])
    expect(res.statusCode).not.toBe(409)
    expect(findUnboundMock).not.toHaveBeenCalled()
  })

  it("a bound credential passes on an exposed workflow", async () => {
    serve({ shared: true, activeApps: 0 })
    findUnboundMock.mockResolvedValue([])
    const res = await fullSave([CRED_HOOK])
    expect(res.statusCode).not.toBe(409)
  })
})
