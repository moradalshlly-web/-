import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/instagram.js", () => ({ runInstagramScrape: vi.fn() }))
const mediaMocks = vi.hoisted(() => ({
  classifyAndStoreInstagramMedia: vi.fn(async (posts: Array<Record<string, unknown>>) => ({
    posts: posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
    stats: { classified: 0, stored: 0, videosStored: 0, kept: posts.length, filteredOut: 0 },
  })),
}))
vi.mock("../../lib/instagram-media.js", () => ({
  classifyAndStoreInstagramMedia: mediaMocks.classifyAndStoreInstagramMedia,
  instagramWithoutMedia: (posts: Array<Record<string, unknown>>) => posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
}))
const analysisMocks = vi.hoisted(() => ({ analyzeInstagramPosts: vi.fn() }))
vi.mock("../../lib/instagram-analysis.js", () => ({ analyzeInstagramPosts: analysisMocks.analyzeInstagramPosts }))
const creditMocks = vi.hoisted(() => ({ reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1" }), guardIds: [] as string[] }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => { creditMocks.guardIds.push(resolve(req)) },
  reserveCreditsForJob: creditMocks.reserveCreditsForJob,
}))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: vi.fn(), refundReservedCreditsForJob: vi.fn() }))
vi.mock("../../lib/credit-base-cost.js", () => ({ baseCreditCostFor: vi.fn(async (id: string) => (id.includes("analysis") ? 1 : 20)) }))
const jobMocks = vi.hoisted(() => ({ markJobCompleted: vi.fn(async () => true), markJobFailed: vi.fn(async () => true), commitJobCredits: vi.fn() }))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: jobMocks.markJobCompleted, commitJobCredits: jobMocks.commitJobCredits }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: jobMocks.markJobFailed }))
const cloudMocks = vi.hoisted(() => ({ shouldRunOnCloud: vi.fn(async () => false), callCloudRoute: vi.fn() }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({ callCloudRoute: cloudMocks.callCloudRoute }))
// Give the analysis-key guard a key so the local-analysis path is testable in
// any environment (CI has no LLM keys); everything else stays the real config.
vi.mock("../../lib/config.js", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, KIE_API_KEY: "test-key" } }
})
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: () => ({ insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }) }) },
}))

async function buildTestApp() {
  const { instagramScrapeRoutes } = await import("../instagram-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(instagramScrapeRoutes)
  return app
}

const POST = { postId: "1", shortCode: "AbC", caption: "just do it", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }
const POST_OUT = { ...POST, format: "unknown", creatives: [] }

describe("POST /v1/instagram-scrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    creditMocks.guardIds.length = 0
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    jobMocks.markJobCompleted.mockResolvedValue(true)
  })

  it("profile happy path: defaults applied, provider called, json + featured text echoed, tier billed by count × sources", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike", "adidas"], count: 30 } })
    expect(res.statusCode).toBe(200)
    expect(runInstagramScrape).toHaveBeenCalledWith(expect.objectContaining({ mode: "profile", targets: ["nike", "adidas"], count: 30, period: "30d" }))
    expect(res.json().json).toEqual([POST_OUT])
    expect(res.json().text).toBe("just do it")
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:100"]) // 30 × 2 → 100 tier
    expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "instagram-scrape:100")
  })

  it("dedupes duplicate targets so a hand-crafted body bills unique sources", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike", "NIKE", "@nike"], count: 20 } })
    expect(res.statusCode).toBe(200)
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:20"]) // 3 duplicate targets → 1 source → 20 × 1 tier
    expect(runInstagramScrape).toHaveBeenCalledWith(expect.objectContaining({ targets: ["nike"] }))
  })

  it("forwards analysis and settles per analysed post (count-based commit)", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    analysisMocks.analyzeInstagramPosts.mockResolvedValue({
      posts: [{ ...POST_OUT, analysis: { summary: "ok" } }],
      stats: { requested: 1, analyzed: 1, failed: 0, skipped: 0, providerCostUsd: 0.001, usageComplete: true },
    })
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"], count: 20, analyze: true } })
    expect(res.statusCode).toBe(200)
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:20:analysis:economy"])
    expect(analysisMocks.analyzeInstagramPosts).toHaveBeenCalled()
    expect(jobMocks.commitJobCredits).toHaveBeenCalledWith("u-1", "job-1", null, 21, true) // 20 scrape + 1×1 analysed
  })

  it("relays to the nodaro.ai connection on a keyless install", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.callCloudRoute.mockResolvedValue({ jobId: "cloud-9", json: [POST] })
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "hashtag", targets: ["running"] } })
    expect(res.statusCode).toBe(200)
    expect(cloudMocks.callCloudRoute).toHaveBeenCalledWith("/v1/instagram-scrape", expect.objectContaining({ mode: "hashtag" }))
    expect(runInstagramScrape).not.toHaveBeenCalled()
    expect(res.json().jobId).toBe("job-1")
  })

  it("400 on empty / too many targets", async () => {
    const app = await buildTestApp()
    expect((await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: [] } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["a", "b", "c", "d", "e", "f"] } })).statusCode).toBe(400)
  })

  it("502 + refund on a provider error", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runInstagramScrape).mockRejectedValue(new Error("blocked"))
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"] } })
    expect(res.statusCode).toBe(502)
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })
})
