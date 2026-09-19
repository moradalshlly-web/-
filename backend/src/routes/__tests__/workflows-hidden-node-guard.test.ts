import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The workflow WRITE guards ask who is saving.
 *
 * The admin switch (Admin → Availability) hides a node from the deployment's
 * users. A user cannot save a workflow that uses one — but an admin can, because
 * an admin still runs what they have not released. The guard's answer is the
 * shared `findDeniedNodeTypesForUser`; this suite pins the WIRING at the three
 * doors that accept nodes (flat create, project create, autosave PATCH), since a
 * call site that forgot the user id would silently treat every admin as a user.
 * (The fourth guard, on sub-workflow create, reads a body whose schema carries no
 * nodes — there is nothing for it to refuse.)
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
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

const admins = vi.hoisted(() => ({ ids: new Set<string>() }))
const checkIsAdmin = vi.hoisted(() => vi.fn<(userId: string) => Promise<boolean>>())
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin,
}))

// The gateable universe comes from the node registry; its real module pulls the
// credits graph in behind the config stub above. Three rows are all the override
// needs to invert over.
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "generate-image", category: "ai-image" },
    { type: "instagram-scrape", category: "input" },
  ],
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const PROJECT_ID = "00000000-0000-4000-8000-000000000010"

const HIDDEN_NODE = { id: "n1", type: "instagram-scrape", position: { x: 0, y: 0 }, data: {} }
const DENIAL = /not available on this deployment: instagram-scrape/

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  admins.ids = new Set([ADMIN])
  checkIsAdmin.mockImplementation(async (userId) => admins.ids.has(userId))
  // The stored override: everything on except the scraper.
  __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt", "generate-image"]) })

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

const create = (userId: string) =>
  app.inject({
    method: "POST",
    url: "/v1/workflows",
    headers: { "x-user-id": userId },
    payload: { name: "Scrape", nodes: [HIDDEN_NODE], edges: [] },
  })

/** Project create resolves the project's scope BEFORE the guard, so the stub
 *  has to hand back a project the caller owns. */
function ownProject(userId: string): void {
  const row = { data: { id: PROJECT_ID, app_slug: null, user_id: userId, workspace_id: null }, error: null }
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "update"]) builder[m] = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue(row)
  builder.single = vi.fn().mockResolvedValue(row)
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(builder)
}

const createInProject = (userId: string) => {
  ownProject(userId)
  return app.inject({
    method: "POST",
    url: `/v1/projects/${PROJECT_ID}/workflows`,
    headers: { "x-user-id": userId },
    payload: { name: "Scrape", nodes: [HIDDEN_NODE], edges: [] },
  })
}

const autosave = (userId: string) =>
  app.inject({
    method: "PATCH",
    url: `/v1/workflows/${WORKFLOW_ID}`,
    headers: { "x-user-id": userId },
    payload: { nodes: [HIDDEN_NODE], edges: [] },
  })

describe("workflow write guards — a node hidden from users", () => {
  it.each([
    ["create", create],
    ["create in a project", createInProject],
    ["autosave PATCH", autosave],
  ] as const)("%s: a user is refused with the coded availability message", async (_name, send) => {
    const res = await send(USER)
    expect(checkIsAdmin).toHaveBeenCalledWith(USER)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toMatch(DENIAL)
  })

  it.each([
    ["create", create],
    ["create in a project", createInProject],
    ["autosave PATCH", autosave],
  ] as const)("%s: an admin is NOT refused for availability", async (_name, send) => {
    const res = await send(ADMIN)
    // The bare supabase stub fails the write further down — irrelevant here.
    // What matters is that the availability guard REACHED its decision (it asked
    // who this user is, so the route did not die earlier) and let the admin past.
    expect(checkIsAdmin).toHaveBeenCalledWith(ADMIN)
    expect(JSON.stringify(res.json())).not.toMatch(DENIAL)
  })

  it("a workflow without a hidden node is never refused for availability, whoever saves it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Plain", nodes: [{ id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: {} }], edges: [] },
    })
    expect(JSON.stringify(res.json())).not.toMatch(/not available on this deployment/)
  })
})
