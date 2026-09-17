import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/meta-ads.js", () => ({
  runMetaAdsScrape: vi.fn(),
}))
const creditMocks = vi.hoisted(() => ({
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
  guardIds: [] as string[],
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => {
    creditMocks.guardIds.push(resolve(req))
  },
  reserveCreditsForJob: creditMocks.reserveCreditsForJob,
}))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
}))
const jobMocks = vi.hoisted(() => ({
  markJobCompleted: vi.fn(async () => true),
  markJobFailed: vi.fn(async () => true),
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: jobMocks.markJobCompleted }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: jobMocks.markJobFailed }))
const cloudMocks = vi.hoisted(() => ({
  shouldRunOnCloud: vi.fn(async () => false),
  callCloudRoute: vi.fn(),
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({ callCloudRoute: cloudMocks.callCloudRoute }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
    }),
  },
}))

async function buildTestApp() {
  const { metaAdsScrapeRoutes } = await import("../meta-ads-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(metaAdsScrapeRoutes)
  return app
}

const AD = { adArchiveId: "1", pageName: "Nike", images: ["https://img/1.jpg"] }

describe("POST /v1/meta-ads-scrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    creditMocks.guardIds.length = 0
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    jobMocks.markJobCompleted.mockResolvedValue(true)
    jobMocks.markJobFailed.mockResolvedValue(true)
  })

  it("search happy path: defaults applied, provider called with the parsed body, json echoed with the local job id", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "running shoes" },
    })
    expect(res.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith({
      mode: "search", query: "running shoes", count: 20, period: "30d", activeStatus: "active", countryCode: "ALL",
    })
    expect(res.json()).toEqual({ jobId: "job-1", json: [AD] })
  })

  it("guard (raw body) and reservation (parsed body) resolve the SAME tier", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.facebook.com/nike", "facebook.com/adidas"], count: 30 },
    })
    expect(creditMocks.guardIds).toEqual(["meta-ads-scrape:100"]) // 30 × 2 → 100 tier
    expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "meta-ads-scrape:100")
  })

  it("guard and reservation still agree when count is OMITTED (Zod default × sources)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.facebook.com/a", "https://www.facebook.com/b", "https://www.facebook.com/c"] },
    })
    const reservedId = creditMocks.reserveCreditsForJob.mock.calls[0][3]
    expect(reservedId).toBe("meta-ads-scrape:100") // default 20 × 3 pages → 60 → 100 tier
    expect(creditMocks.guardIds).toEqual([reservedId])
  })

  it("pages mode infers the scheme and normalizes the country code", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["facebook.com/nike"], countryCode: " us ", period: "7d", activeStatus: "all", count: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({
      pageUrls: ["https://facebook.com/nike"], countryCode: "US", period: "7d", activeStatus: "all", count: 5,
    }))
  })

  it("passes a platform filter through and rejects an unknown platform", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const ok = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike", platforms: ["INSTAGRAM", "THREADS"] },
    })
    expect(ok.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({ platforms: ["INSTAGRAM", "THREADS"] }))
    const bad = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike", platforms: ["TIKTOK"] },
    })
    expect(bad.statusCode).toBe(400)
  })

  it("400 on an empty body", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("400 when a page url is not on facebook.com", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.instagram.com/nike"] },
    })
    expect(res.statusCode).toBe(400)
    expect(runMetaAdsScrape).not.toHaveBeenCalled()
  })

  it("400 above the count ceiling, above the sources ceiling, or with a bad country code", async () => {
    const app = await buildTestApp()
    const tooMany = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "x", count: 101 },
    })
    expect(tooMany.statusCode).toBe(400)
    const tooManyPages = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: Array.from({ length: 6 }, (_, i) => `https://www.facebook.com/p${i}`) },
    })
    expect(tooManyPages.statusCode).toBe(400)
    const badCountry = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "x", countryCode: "USA" },
    })
    expect(badCountry.statusCode).toBe(400)
  })

  it("relays to the nodaro.ai connection when the install has no Apify token — same shape, local job id", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.callCloudRoute.mockResolvedValue({ jobId: "cloud-job-9", json: [AD] })
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike" },
    })
    expect(res.statusCode).toBe(200)
    expect(cloudMocks.callCloudRoute).toHaveBeenCalledWith("/v1/meta-ads-scrape", expect.objectContaining({ mode: "search", query: "nike" }))
    expect(runMetaAdsScrape).not.toHaveBeenCalled()
    expect(res.json().jobId).toBe("job-1")
    expect(res.json().json).toEqual([AD])
  })

  it("502 + refund (by job id) on a provider error", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob, refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockRejectedValue(Object.assign(new Error("The target site blocked the scrape."), { name: "ApifyError" }))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "scrape_error", message: "The target site blocked the scrape." })
    expect(jobMocks.markJobFailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ error_message: "The target site blocked the scrape." }))
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("does NOT refund when the failure CAS missed (the cancel path already refunded)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockRejectedValue(new Error("boom"))
    jobMocks.markJobFailed.mockResolvedValueOnce(false)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(502)
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("commits the reservation (by job id) on success, through the completion funnel", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    const app = await buildTestApp()
    await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(jobMocks.markJobCompleted).toHaveBeenCalledWith("job-1", { output_data: { json: [AD] } })
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("409 and no commit when the job was cancelled mid-flight (completion CAS lost)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    jobMocks.markJobCompleted.mockResolvedValueOnce(false)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("job_cancelled")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("skips commit/refund entirely when nothing was reserved (community edition)", async () => {
    creditMocks.reserveCreditsForJob.mockResolvedValueOnce(undefined)
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(200)
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})
