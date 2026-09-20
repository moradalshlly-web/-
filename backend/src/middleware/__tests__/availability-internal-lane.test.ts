import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The orchestrator's INTERNAL call reaches the availability guard as the
 * execution's own user — through the REAL auth hook, not a stand-in.
 *
 * A sync-HTTP node (instagram-scrape, meta-ads-scrape, …) is run by the
 * orchestrator posting to its route on localhost with the shared secret and the
 * execution's user in `body.userId`. That request carries no JWT, so no
 * `req.userRole` exists on it — which is exactly why availability is keyed on
 * the user id. This pins the whole lane: auth hook → `req.userId` → the route's
 * `creditGuard` → per-user availability. It also pins the other half: WITHOUT
 * the secret, a caller-supplied `body.userId` is never read, so naming an admin
 * in the body buys nothing.
 */

const admins = vi.hoisted(() => ({ ids: new Set<string>() }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      then: vi.fn(),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: async (userId: string) => admins.ids.has(userId),
}))

// The REAL config (the auth hook needs its internal secret), on an edition with
// no credits: past the availability check `creditGuard` is then a no-op, so a
// 200 here means exactly "the guard let this user through".
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => false,
  isCloud: () => false,
  isBusiness: () => true,
  isCommunity: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "instagram-scrape", category: "input" },
    { type: "web-scrape", category: "input" },
  ],
}))

import { registerAuthHook } from "../auth.js"
import { creditGuard } from "../credit-guard.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-000000000001"
const SECRET = process.env.INTERNAL_ORCHESTRATOR_SECRET as string

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  admins.ids = new Set([ADMIN])
  // The stored override: instagram-scrape is withheld from users.
  __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image", "web-scrape"]) })

  app = Fastify({ logger: false })
  registerAuthHook(app)
  // The REAL guard at the REAL path, so `req.routeOptions.url` is the true node-type key.
  app.post("/v1/instagram-scrape", { preHandler: creditGuard(() => "instagram-scrape") }, async (req) => ({
    ranAs: req.userId ?? null,
  }))
  app.post("/v1/web-scrape", { preHandler: creditGuard(() => "web-scrape:instagram") }, async (req) => ({
    ranAs: req.userId ?? null,
  }))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const internalRun = (userId: string) =>
  app.inject({
    method: "POST",
    url: "/v1/instagram-scrape",
    headers: { "x-internal-orchestrator-secret": SECRET },
    payload: { userId, mode: "profile", targets: ["nasa"] },
  })

describe("orchestrator-internal call → auth hook → creditGuard → per-user availability", () => {
  it("has a secret to test with", () => {
    expect(typeof SECRET).toBe("string")
    expect(SECRET.length).toBeGreaterThanOrEqual(32)
  })

  it("an ADMIN's execution runs a node withheld from users", async () => {
    const res = await internalRun(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ranAs: ADMIN })
  })

  it("a USER's execution of the same node — e.g. running an admin-built app — is refused", async () => {
    const res = await internalRun(USER)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    expect(res.json().error.message).toContain("instagram-scrape")
  })

  it("naming an admin in the body WITHOUT the secret buys nothing: the body is never read", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/instagram-scrape",
      headers: { authorization: "Bearer not-a-real-token" },
      payload: { userId: ADMIN, mode: "profile", targets: ["nasa"] },
    })
    expect(res.statusCode).toBe(401)
  })

  it("a wrong secret is refused outright, whoever the body names", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/instagram-scrape",
      headers: { "x-internal-orchestrator-secret": "x".repeat(64) },
      payload: { userId: ADMIN },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })
})

// Web Scrape stays released; its Instagram source follows the withheld Instagram node.
describe("the same lane for a capability hosted inside another node", () => {
  const internalScrape = (userId: string, actor: string) =>
    app.inject({
      method: "POST",
      url: "/v1/web-scrape",
      headers: { "x-internal-orchestrator-secret": SECRET },
      payload: { userId, actor, target: "nasa" },
    })

  it("a USER's execution of Web Scrape → Instagram is refused; an ADMIN's runs", async () => {
    const asUser = await internalScrape(USER, "instagram")
    expect(asUser.statusCode).toBe(403)
    expect(asUser.json().error.message).toContain("web-scrape:instagram")

    const asAdmin = await internalScrape(ADMIN, "instagram")
    expect(asAdmin.statusCode).toBe(200)
    expect(asAdmin.json()).toEqual({ ranAs: ADMIN })
  })

  it("a USER's execution of any other source runs", async () => {
    expect((await internalScrape(USER, "google-search")).statusCode).toBe(200)
  })
})
