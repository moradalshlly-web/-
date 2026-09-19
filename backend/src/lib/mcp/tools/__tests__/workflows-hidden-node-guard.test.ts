import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * The MCP workflow WRITE tools ask who the session acts for.
 *
 * An agent-authored workflow never passes through the node picker, so
 * `create_workflow` / `update_workflow_json` carry the availability guard
 * themselves. The admin switch hides a node from users, not from admins — and an
 * MCP session acts AS its resource owner, so an admin driving Claude keeps the
 * node while a user's session is refused with the shared coded message.
 */

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const admins = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("../../../admin-check.js", () => ({
  checkIsAdmin: async (userId: string) => admins.ids.has(userId),
}))
vi.mock("../../../node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "generate-image", category: "ai-image" },
    { type: "instagram-scrape", category: "input" },
  ],
}))

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests } = await import(
  "../../../availability-override.js"
)

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>
const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const SCOPES: Scope[] = ["workflows:read", "workflows:write"]
const DENIAL = /not available on this deployment: instagram-scrape/

const HIDDEN = [{ id: "n1", type: "instagram-scrape", position: { x: 0, y: 0 }, data: {} }]

function sessionFor(userId: string): McpSession {
  const s = newSession({ userId, scopes: SCOPES, clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

/** Permissive chainable stub — the guard runs before any of it matters. */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(() => {
  vi.clearAllMocks()
  admins.ids = new Set(["admin-1"])
  __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt", "generate-image"]) })
  fromMock.mockReturnValue(chain({ data: { id: "w1", name: "Scrape" }, error: null }))
})

afterEach(() => __resetAvailabilityOverridesForTests())

const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

function callAs(userId: string, tool: "create_workflow" | "update_workflow_json") {
  const server = buildServer()
  registerWorkflows({ server, session: sessionFor(userId), fastify: Fastify() })
  return tool === "create_workflow"
    ? callTool(server, tool, { name: "Scrape", nodes: HIDDEN, edges: [] })
    : callTool(server, tool, { workflow_id: WORKFLOW_ID, nodes: HIDDEN, edges: [] })
}

describe("MCP workflow write guard — a node hidden from users", () => {
  it.each(["create_workflow", "update_workflow_json"] as const)(
    "%s: refuses a user's session with the shared availability message, before any write",
    async (tool) => {
      const result = await callAs("user-1", tool)
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(DENIAL)
      expect(fromMock).not.toHaveBeenCalled()
    },
  )

  it.each(["create_workflow", "update_workflow_json"] as const)(
    "%s: does not refuse an admin's session for availability",
    async (tool) => {
      const result = await callAs("admin-1", tool)
      expect(JSON.stringify(result.content)).not.toMatch(DENIAL)
    },
  )
})
