/**
 * What an RSS run is charged for — route and REAL parser together.
 *
 * web-scrape.test.ts mocks the parser, so it cannot see the bug this guards:
 * on 2026-09-20 an Atom feed (figma.com/blog/feed/atom.xml, 747 entries) parsed
 * to `[]`, the route completed the job with `{"json": []}` and the credits were
 * committed. Only the network is faked here (`safeFetch`); everything between
 * the HTTP body and the settlement is the production code.
 *
 *   an Atom feed                → completed, committed, populated json
 *   a valid feed with no items  → completed, committed, []   (documented policy)
 *   a body that is not a feed   → failed, REFUNDED, 502
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { BLOG_ATOM, HTML_ERROR_PAGE, YOUTUBE_CHANNEL_ATOM } from "../../providers/rss/__tests__/fixtures/atom-feeds.js"

const net = vi.hoisted(() => ({ safeFetch: vi.fn() }))
// Only the network call is replaced: the route's URL validator imports its
// private-address check from the same module and must keep the real one.
vi.mock("../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/safe-fetch.js")>()),
  safeFetch: net.safeFetch,
}))
vi.mock("../../providers/apify/scraper.js", () => ({ runScraper: vi.fn() }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))
const settle = vi.hoisted(() => ({
  markJobCompleted: vi.fn(async () => true),
  markJobFailed: vi.fn(async () => true),
  commit: vi.fn(async () => {}),
  refund: vi.fn(async () => 0),
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: settle.markJobCompleted }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: settle.markJobFailed }))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: settle.commit,
  refundReservedCreditsForJob: settle.refund,
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: vi.fn(async () => false) }))
vi.mock("../../providers/nodaro/client.js", () => ({ createCloudJob: vi.fn(), waitForCloudJob: vi.fn() }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
    }),
  },
}))

async function buildTestApp() {
  const { webScrapeRoutes } = await import("../web-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(webScrapeRoutes)
  return app
}

function answers(body: string, status = 200, contentType = "application/atom+xml") {
  net.safeFetch.mockImplementation(
    async () => new Response(new TextEncoder().encode(body), { status, headers: { "content-type": contentType } }),
  )
}

async function runRss(url = "https://www.example.com/feed/atom.xml") {
  const app = await buildTestApp()
  return app.inject({ method: "POST", url: "/v1/web-scrape", payload: { actor: "rss", url } })
}

describe("POST /v1/web-scrape (rss) — what is charged", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settle.markJobCompleted.mockResolvedValue(true)
    settle.markJobFailed.mockResolvedValue(true)
  })

  it("an Atom feed completes with populated items and is charged", async () => {
    answers(BLOG_ATOM)
    const res = await runRss()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.json).toHaveLength(2)
    expect(body.json[0]).toEqual({
      title: "Try these 5 tools—and share your own",
      url: "https://blog.example.com/try-these-5-tools/",
      description: "Publishing is now live. <b>Here</b> are a few tools that stand out.",
      pubDate: "2026-09-16T12:00:00.000Z",
      guid: "https://blog.example.com/try-these-5-tools/",
    })
    expect(settle.markJobCompleted).toHaveBeenCalledWith("job-1", { output_data: { json: body.json } })
    expect(settle.commit).toHaveBeenCalledTimes(1)
    expect(settle.refund).not.toHaveBeenCalled()
  })

  it("a YouTube channel feed completes with populated items", async () => {
    answers(YOUTUBE_CHANNEL_ATOM, 200, "text/xml; charset=UTF-8")
    const res = await runRss("https://www.youtube.com/feeds/videos.xml?channel_id=UCexample0000000000000000")
    expect(res.statusCode).toBe(200)
    expect(res.json().json.map((i: { guid: string }) => i.guid)).toEqual(["yt:video:AAAAAAAAAAA", "yt:video:BBBBBBBBBBB"])
  })

  it("a valid feed with no items is a completed, charged run — the documented policy", async () => {
    answers(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Nothing yet</title></feed>`)
    const res = await runRss()
    expect(res.statusCode).toBe(200)
    expect(res.json().json).toEqual([])
    expect(settle.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(settle.commit).toHaveBeenCalledTimes(1)
    expect(settle.refund).not.toHaveBeenCalled()
  })

  it("a body that is not a feed FAILS and is REFUNDED — never completed, never charged", async () => {
    answers(HTML_ERROR_PAGE, 200, "text/html; charset=UTF-8")
    const res = await runRss()
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("scrape_error")
    expect(res.json().error.message).toMatch(/not an RSS or Atom feed/i)
    expect(settle.markJobCompleted).not.toHaveBeenCalled()
    expect(settle.commit).not.toHaveBeenCalled()
    expect(settle.markJobFailed).toHaveBeenCalledTimes(1)
    expect(settle.refund).toHaveBeenCalledTimes(1)
    // One request: a wrong document is a verdict, not a blip.
    expect(net.safeFetch).toHaveBeenCalledTimes(1)
  })

  it("a JSON body fails and is refunded too", async () => {
    answers(`{"items":[]}`, 200, "application/json")
    const res = await runRss()
    expect(res.statusCode).toBe(502)
    expect(settle.refund).toHaveBeenCalledTimes(1)
    expect(settle.commit).not.toHaveBeenCalled()
  })
})
