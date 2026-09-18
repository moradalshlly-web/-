/**
 * Meta Ads creatives: classify every ad's format from its pixels, filter by
 * the node's format setting, copy kept creatives into the library — always
 * degrading to the external url, never failing the paid scrape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** Pixel size per url — the fake CDN. Missing = the fetch fails. Hoisted so the sharp mock can read it. */
const PIXELS: Record<string, { width: number; height: number }> = vi.hoisted(() => ({
  "https://cdn/vertical.jpg": { width: 1080, height: 1920 },
  "https://cdn/square.jpg": { width: 1080, height: 1080 },
  "https://cdn/wide.jpg": { width: 1920, height: 1080 },
  "https://cdn/poster.jpg": { width: 1080, height: 1920 },
}))

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  storeImportedImageBuffer: vi.fn(),
  isStorageConfigured: vi.fn(() => true),
  uploadToR2: vi.fn(),
  insertSingle: vi.fn(),
}))

// The fake CDN returns the url itself as the "bytes", so sharp can answer
// from the same table — concurrency-safe (no "last call" bookkeeping).
vi.mock("sharp", () => ({
  default: vi.fn((buf: Buffer) => ({ metadata: async () => PIXELS[buf.toString()] ?? {} })),
}))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../media-import.js", () => ({
  storeImportedImageBuffer: mocks.storeImportedImageBuffer,
  readBodyCapped: async (res: { body: Buffer }) => res.body,
}))
vi.mock("../storage.js", () => ({
  isStorageConfigured: mocks.isStorageConfigured,
  uploadToR2: mocks.uploadToR2,
  // Faithful to the real helper: typed error OR the legacy message prefix.
  isStorageLimitError: (err: unknown) => err instanceof Error && err.message.includes("storage-limit-exceeded"),
}))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({ insert: () => ({ select: () => ({ single: mocks.insertSingle }) }) }) },
}))

import { classifyAndStoreMetaAdsMedia, metaAdsWithoutMedia } from "../meta-ads-media.js"

describe("metaAdsWithoutMedia (the route's fallback when the media step itself throws)", () => {
  it("keeps every ad as scraped: unknown format, source urls, nothing stored", () => {
    const ad = {
      adArchiveId: "1", pageName: "Nike",
      images: ["https://cdn/i.jpg"], videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn/p.jpg"],
    } as unknown as MetaAd
    const [out] = metaAdsWithoutMedia([ad])
    expect(out.format).toBe("unknown")
    expect(out.images).toEqual(["https://cdn/i.jpg"])
    expect(out.videos).toEqual(["https://cdn/v.mp4"])
    expect(out.creatives).toEqual([
      expect.objectContaining({ kind: "video", url: "https://cdn/v.mp4", posterUrl: "https://cdn/p.jpg", format: "unknown", stored: false, assetId: null }),
      expect.objectContaining({ kind: "image", url: "https://cdn/i.jpg", format: "unknown", stored: false, assetId: null }),
    ])
  })
})
import type { MetaAd } from "../../providers/apify/meta-ads.js"

function ad(id: string, over: Partial<MetaAd> = {}): MetaAd {
  return {
    adArchiveId: id, adLibraryUrl: `https://www.facebook.com/ads/library/?id=${id}`, pageName: "Nike", pageId: "9",
    startDate: null, endDate: null, isActive: true, platforms: ["FACEBOOK"], text: "copy", title: null, caption: null,
    ctaText: null, linkUrl: null, images: [], videos: [], videoPreviews: [], collationCount: null, ...over,
  }
}

const OPTS = { userId: "u1", jobId: "job-1", deadlineAt: Number.MAX_SAFE_INTEGER, storeImages: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isStorageConfigured.mockReturnValue(true)
  mocks.safeFetch.mockImplementation(async (url: string) => {
    const px = PIXELS[url]
    return px ? { ok: true, body: Buffer.from(url) } : { ok: false }
  })
  mocks.storeImportedImageBuffer.mockImplementation(async (args: { body: Buffer; filename?: string }) => ({
    ok: true, url: `https://r2/${args.filename}.jpg`, thumbnailUrl: null, assetId: `asset-${args.filename}`,
    mimeType: "image/jpeg", sizeBytes: 1, filename: args.filename ?? "", width: 1, height: 1,
  }))
  mocks.uploadToR2.mockResolvedValue("https://r2/videos/meta-ad-1.mp4")
  mocks.insertSingle.mockResolvedValue({ data: { id: "asset-video" }, error: null })
})

describe("classifyAndStoreMetaAdsMedia", () => {
  it("classifies each ad by its primary creative (first video's poster, else first image)", async () => {
    const ads = [
      ad("1", { images: ["https://cdn/vertical.jpg"] }),
      ad("2", { images: ["https://cdn/wide.jpg", "https://cdn/vertical.jpg"] }),
      ad("3", { videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn/poster.jpg"], images: ["https://cdn/wide.jpg"] }),
      ad("4", { images: ["https://cdn/missing.jpg"] }),
      ad("5"),
    ]
    const { ads: out, stats } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, storeImages: false })
    expect(out.map((a) => a.format)).toEqual(["vertical", "horizontal", "vertical", "unknown", "unknown"])
    expect(out[2].creatives.map((c) => c.kind)).toEqual(["video", "image"])
    expect(out[1].creatives.map((c) => c.format)).toEqual(["horizontal", "vertical"])
    expect(stats.kept).toBe(5)
    expect(stats.stored).toBe(0)
  })

  it("keeps only the requested formats and reports what it dropped (unknown never matches)", async () => {
    const ads = [
      ad("1", { images: ["https://cdn/vertical.jpg"] }),
      ad("2", { images: ["https://cdn/square.jpg"] }),
      ad("3", { images: ["https://cdn/wide.jpg"] }),
      ad("4", { images: ["https://cdn/missing.jpg"] }),
    ]
    const { ads: out, stats } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, storeImages: false, formats: ["vertical", "square"] })
    expect(out.map((a) => a.adArchiveId)).toEqual(["1", "2"])
    expect(stats).toMatchObject({ kept: 2, filteredOut: 2 })
  })

  it("stores kept creatives in the library (not in the picker), swapping durable urls in place", async () => {
    const ads = [ad("1", { images: ["https://cdn/vertical.jpg"], videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn/poster.jpg"] })]
    const { ads: out, stats } = await classifyAndStoreMetaAdsMedia(ads, OPTS)
    expect(stats.stored).toBe(2) // the image + the video poster; the video itself was not asked for
    expect(out[0].images).toEqual(["https://r2/meta-ad-1-1.jpg"])
    expect(out[0].videoPreviews).toEqual(["https://r2/meta-ad-1-0-poster.jpg"])
    expect(out[0].videos).toEqual(["https://cdn/v.mp4"]) // external — video not ingested
    expect(out[0].creatives[1]).toMatchObject({ kind: "image", stored: true, assetId: "asset-meta-ad-1-1", sourceUrl: "https://cdn/vertical.jpg" })
    expect(mocks.storeImportedImageBuffer).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", jobId: "job-1", uploadSource: "url_import", source: "meta-ads", inLibrary: false,
    }))
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
  })

  it("stores the featured ad's video only when asked, quota-reserved, with an asset row", async () => {
    const ads = [ad("1", { videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn/poster.jpg"] })]
    const { ads: out, stats } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, storeFeaturedVideoIndex: 0 })
    expect(mocks.uploadToR2).toHaveBeenCalledWith("https://cdn/v.mp4", expect.stringMatching(/^meta-ad-1-/), "video", "u1", { reserveQuota: true })
    expect(out[0].videos).toEqual(["https://r2/videos/meta-ad-1.mp4"])
    expect(out[0].creatives[0]).toMatchObject({ kind: "video", stored: true, assetId: "asset-video" })
    expect(stats.videosStored).toBe(1)
  })

  it("copy-all-videos stores every ad's first video; the featured is not copied twice", async () => {
    const ads = [
      ad("1", { videos: ["https://cdn/v1.mp4"], videoPreviews: ["https://cdn/p1.jpg"] }),
      ad("2", { videos: ["https://cdn/v2.mp4"], videoPreviews: ["https://cdn/p2.jpg"] }),
    ]
    mocks.uploadToR2.mockImplementation(async (url: string) => `https://r2/videos/${url.split("/").pop()}`)
    const { stats } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, storeAllVideos: true, storeFeaturedVideoIndex: 0 })
    // Two ads → two video uploads (not three — the featured overlaps the all-set).
    const videoCalls = mocks.uploadToR2.mock.calls.filter((c: unknown[]) => c[2] === "video")
    expect(videoCalls).toHaveLength(2)
    expect(stats.videosStored).toBe(2)
  })

  it("copy-all-videos stops at the storage quota instead of hammering failed uploads", async () => {
    const ads = [
      ad("1", { videos: ["https://cdn/v1.mp4"], videoPreviews: ["https://cdn/p1.jpg"] }),
      ad("2", { videos: ["https://cdn/v2.mp4"], videoPreviews: ["https://cdn/p2.jpg"] }),
      ad("3", { videos: ["https://cdn/v3.mp4"], videoPreviews: ["https://cdn/p3.jpg"] }),
    ]
    mocks.storeImportedImageBuffer.mockResolvedValue({ ok: true, url: "https://r2/poster.jpg", assetId: "a", width: 1, height: 1 })
    mocks.uploadToR2.mockRejectedValue(new Error("storage-limit-exceeded: atomic reservation refused"))
    const { stats } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, storeAllVideos: true, concurrency: 1 })
    expect(stats.videosStored).toBe(0)
    expect(stats.skipReason).toBe("storage_limit_exceeded")
    // Stopped early: not one upload attempt per ad after the first refusal.
    const videoCalls = mocks.uploadToR2.mock.calls.filter((c: unknown[]) => c[2] === "video")
    expect(videoCalls.length).toBeLessThan(3)
  })

  it("degrades honestly: a full quota keeps the external urls and says so; no storage config never stores", async () => {
    mocks.storeImportedImageBuffer.mockResolvedValue({ ok: false, status: 413, code: "storage_limit_exceeded", message: "full" })
    const ads = [ad("1", { images: ["https://cdn/vertical.jpg"] }), ad("2", { images: ["https://cdn/square.jpg"] })]
    const full = await classifyAndStoreMetaAdsMedia(ads, OPTS)
    expect(full.stats).toMatchObject({ stored: 0, skipReason: "storage_limit_exceeded" })
    expect(full.ads[0].images).toEqual(["https://cdn/vertical.jpg"])
    expect(full.ads[0].format).toBe("vertical") // classification still happened

    // Parallel workers may each have started one store before the quota
    // answer landed; what matters is that nothing stored and nothing was lost.
    const callsAfterFullQuota = mocks.storeImportedImageBuffer.mock.calls.length
    expect(callsAfterFullQuota).toBeGreaterThanOrEqual(1)

    mocks.isStorageConfigured.mockReturnValue(false)
    const unconfigured = await classifyAndStoreMetaAdsMedia(ads, OPTS)
    expect(unconfigured.stats).toMatchObject({ stored: 0, skipReason: "not_configured" })
    expect(mocks.storeImportedImageBuffer).toHaveBeenCalledTimes(callsAfterFullQuota) // the unconfigured run never reached the store step
  })

  it("stops starting work past the deadline and reports it", async () => {
    let t = 0
    const ads = [ad("1", { images: ["https://cdn/vertical.jpg"] }), ad("2", { images: ["https://cdn/square.jpg"] })]
    const { stats, ads: out } = await classifyAndStoreMetaAdsMedia(ads, { ...OPTS, deadlineAt: 1, now: () => t++, concurrency: 1 })
    expect(stats.skipReason).toBe("deadline")
    expect(out).toHaveLength(2) // nothing dropped, just unclassified / unstored
  })
})
