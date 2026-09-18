/**
 * The generic scraped-media step's NEW capability over the Meta path: when the
 * source reports pixel dimensions (knownDims), classify + format-filter run
 * WITHOUT a probe fetch. (The store path and quota/deadline behaviour are
 * covered end-to-end by the Meta adapter's tests.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn(), isStorageConfigured: vi.fn(() => false) }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../media-import.js", () => ({ readBodyCapped: vi.fn(), storeImportedImageBuffer: vi.fn() }))
vi.mock("../storage.js", () => ({ isStorageConfigured: mocks.isStorageConfigured, uploadToR2: vi.fn(), isStorageLimitError: () => false }))
vi.mock("../supabase.js", () => ({ supabase: { from: () => ({ insert: () => ({ select: () => ({ single: vi.fn() }) }) }) } }))
vi.mock("sharp", () => ({ default: vi.fn() }))

import { classifyAndStoreScrapedMedia, type ScrapedMediaItem } from "../scraped-media.js"

const OPTS = { userId: "u1", jobId: "job-1", deadlineAt: Date.now() + 60_000, storeImages: false, source: "test", filePrefix: "t" }

describe("classifyAndStoreScrapedMedia — knownDims", () => {
  beforeEach(() => vi.clearAllMocks())

  it("classifies from known dims and filters by format WITHOUT fetching", async () => {
    const items: ScrapedMediaItem[] = [
      { id: "tall", images: ["https://cdn/tall.jpg"], videos: [], knownDims: { "https://cdn/tall.jpg": { width: 1080, height: 1920 } } },
      { id: "wide", images: ["https://cdn/wide.jpg"], videos: [], knownDims: { "https://cdn/wide.jpg": { width: 1920, height: 1080 } } },
    ]
    const { items: out, keptIndexes, stats } = await classifyAndStoreScrapedMedia(items, { ...OPTS, formats: ["vertical"] })
    expect(mocks.safeFetch).not.toHaveBeenCalled() // dims known → no download
    expect(out.map((i) => i.format)).toEqual(["vertical"])
    expect(keptIndexes).toEqual([0])
    expect(stats).toMatchObject({ classified: 2, kept: 1, filteredOut: 1 })
  })

  it("falls back to a probe fetch when dims are absent", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: false })
    const items: ScrapedMediaItem[] = [{ id: "x", images: ["https://cdn/x.jpg"], videos: [] }]
    await classifyAndStoreScrapedMedia(items, OPTS)
    expect(mocks.safeFetch).toHaveBeenCalledWith("https://cdn/x.jpg", expect.anything())
  })

  it("does NOT re-fetch a url whose probe already failed in the classify pass", async () => {
    // Regression: the store pass reused `probes.get(url) ?? undefined`, which
    // conflates a cached miss (null) with "never probed", so an expired CDN url
    // — the exact case this module exists for — got fetched twice, burning the
    // deadline. A cached miss must be skipped, not re-fetched.
    mocks.isStorageConfigured.mockReturnValue(true)
    mocks.safeFetch.mockResolvedValue({ ok: false }) // probe fails → cached as a miss
    const items: ScrapedMediaItem[] = [{ id: "dead", images: ["https://cdn/dead.jpg"], videos: [] }]
    const { stats } = await classifyAndStoreScrapedMedia(items, { ...OPTS, storeImages: true })
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1) // classify only — no store-pass re-fetch
    expect(stats.stored).toBe(0)
  })
})
