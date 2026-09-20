import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// B4c — the voice-CREATION routes (design/remix) reuse B1's nodes.deny. These
// direct routes create jobs WITHOUT passing a workflow write guard, so B1's
// findDeniedNodeTypes never sees them — the guard is added at the top of each
// handler. A deployment sets nodes.deny to remove the capability. (The MCP
// tools reach these routes via dispatchJob, which surfaces the route's 403 as
// an MCP error — so the route is the single chokepoint for MCP too.)
//
// Voice CLONING is retired platform-wide (2026-09-15): its create routes answer
// 410 `voice_cloning_retired` for every caller, denied or not, and reserve
// nothing — pinned below so the retirement cannot silently regress into a
// deployment knob.

vi.mock("@/lib/config.js", () => ({
  // Business edition → surfaceGateOpen() true → the nodes.deny profile applies.
  config: { EDITION: "business", ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => true,
  isCloud: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1" }),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// The admin switch cases (last block). Who is an admin is the shared check.
const admins = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async (userId: string) => admins.ids.has(userId) }))
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-to-speech", category: "ai-audio" },
    { type: "voice-design", category: "ai-audio" },
    { type: "voice-remix", category: "ai-audio" },
  ],
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }))
// voice-design / voice-remix dispatch to BullMQ on the success path via
// videoQueue.add(...). queue.js eagerly constructs a real IORedis-backed Queue
// at module load, so without this mock the "proceeds past the guard" test hangs
// on unavailable Redis until the 5s timeout. Stub the whole module (the routes
// import only videoQueue; redis/tryRemoveFromQueue stubbed for completeness).
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) },
  redis: { quit: vi.fn() },
  tryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/storage.js", () => ({ uploadBufferToR2: vi.fn() }))
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { voiceCloneRoutes } from "../voice-clones.js"
import { voiceDesignRoutes } from "../voice-design.js"
import { voiceRemixRoutes } from "../voice-remix.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"

async function buildApp(register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
    else req.userId = USER // multipart routes carry no JSON body to read userId from
  })
  await app.register(async (instance) => {
    await register(instance)
  })
  await app.ready()
  return app
}

beforeEach(() => __resetSurfaceProfileCacheForTests())
afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function denyAll() {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["voice-clone", "voice-design", "voice-remix"] } })
  __resetSurfaceProfileCacheForTests()
}

describe("voice-creation routes: B1 nodes.deny (B4c) + the voice-clone retirement", () => {
  it("answers 410 voice_cloning_retired on POST /v1/voice-clones/from-url — retired, not a deny knob", async () => {
    const app = await buildApp(voiceCloneRoutes)
    try {
      for (const deny of [false, true]) {
        if (deny) denyAll()
        const res = await app.inject({
          method: "POST",
          url: "/v1/voice-clones/from-url",
          payload: { name: "x", audioUrl: "https://example.com/a.mp3", userId: USER },
        })
        expect(res.statusCode).toBe(410)
        expect(res.json().error.code).toBe("voice_cloning_retired")
      }
    } finally {
      await app.close()
    }
  })

  it("answers 410 voice_cloning_retired on the multipart POST /v1/voice-clones too", async () => {
    const app = await buildApp(voiceCloneRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-clones",
        headers: { "content-type": "multipart/form-data; boundary=xx" },
        payload: "--xx\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nx\r\n--xx--\r\n",
      })
      expect(res.statusCode).toBe(410)
      expect(res.json().error.code).toBe("voice_cloning_retired")
    } finally {
      await app.close()
    }
  })

  it("refuses POST /v1/voice-design when voice-design is denied", async () => {
    denyAll()
    const app = await buildApp(voiceDesignRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-design",
        payload: { text: "a".repeat(120), voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    } finally {
      await app.close()
    }
  })

  it("refuses POST /v1/voice-remix when voice-remix is denied", async () => {
    denyAll()
    const app = await buildApp(voiceRemixRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-remix",
        payload: { text: "remix this", voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("node_not_available")
    } finally {
      await app.close()
    }
  })

  it("is inert when nothing is denied — voice-design proceeds past the guard", async () => {
    // No profile → default (empty deny). The guard must NOT fire; the request
    // reaches the normal path (200 via the mocked insertJob).
    const app = await buildApp(voiceDesignRoutes)
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice-design",
        payload: { text: "a".repeat(120), voiceDescription: "warm narrator", userId: USER },
      })
      expect(res.statusCode).not.toBe(403)
    } finally {
      await app.close()
    }
  })
})

// The admin switch (Admin → Availability) hides a node from USERS; an admin keeps it.
describe("voice-creation routes: a node the admin switch withholds", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad"
  const LANES = [
    ["voice-design", voiceDesignRoutes, "/v1/voice-design", { text: "a".repeat(120), voiceDescription: "warm narrator" }],
    ["voice-remix", voiceRemixRoutes, "/v1/voice-remix", { text: "remix this", voiceDescription: "warm narrator" }],
  ] as const

  beforeEach(async () => {
    await __availabilityUniverseReadyForTests()
    admins.ids = new Set([ADMIN])
    // Everything on except the two voice-creation nodes.
    __resetAvailabilityOverridesForTests({ nodes: new Set(["text-to-speech"]) })
  })
  afterEach(() => __resetAvailabilityOverridesForTests())

  it.each(LANES)("%s: a user is refused, an admin is not", async (_type, routes, url, body) => {
    const app = await buildApp(routes)
    try {
      const asUser = await app.inject({ method: "POST", url, payload: { ...body, userId: USER } })
      expect(asUser.statusCode).toBe(403)
      expect(asUser.json().error.code).toBe("node_not_available")

      const asAdmin = await app.inject({ method: "POST", url, payload: { ...body, userId: ADMIN } })
      expect(asAdmin.statusCode).not.toBe(403)
      expect(JSON.stringify(asAdmin.json())).not.toContain("node_not_available")
    } finally {
      await app.close()
    }
  })
})
