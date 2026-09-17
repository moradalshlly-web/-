import { describe, it, expect } from "vitest"
import type { MetaAdsScrapeNodeData } from "@/types/nodes"
import {
  applyMetaAdsScrapeFailure,
  applyMetaAdsScrapeResult,
  clampFeaturedIndex,
  deriveMetaAdsScrapeCardState,
  metaAdDateRange,
  metaAdDomain,
  metaAdGlyph,
  metaAdHeadline,
  metaAdInitial,
  metaAdLink,
  metaAdMediaCounts,
  metaAdPeekLine,
  metaAdPlatformLabel,
  metaAdPlatformsShort,
  metaAdPreviewUrl,
  metaAdRunDays,
  metaAdsActiveCount,
  metaAdsScrapeFingerprint,
  metaAdsScrapeItems,
  metaAdsScrapeRunStartPatch,
} from "../meta-ads-scrape-run-state"

const ad = (over: Record<string, unknown> = {}) => ({
  adArchiveId: "1",
  adLibraryUrl: "https://www.facebook.com/ads/library/?id=1",
  pageName: "Nike",
  text: "Just do it.",
  images: ["https://img/1.jpg"],
  videos: [],
  ...over,
})

const base: MetaAdsScrapeNodeData = { label: "Meta Ads", mode: "search", query: "shoes", count: 20, period: "30d" }

describe("meta-ads-scrape run state", () => {
  it("peek line is 'Page — copy', glyph flags video creatives", () => {
    expect(metaAdPeekLine(ad())).toBe("Nike — Just do it.")
    expect(metaAdPeekLine(ad({ pageName: "", text: "", title: "Air Max" }))).toBe("Air Max")
    expect(metaAdGlyph(ad())).toBe("▣")
    expect(metaAdGlyph(ad({ videos: ["https://vid/1.mp4"] }))).toBe("▶")
  })

  it("only http(s) Ad Library urls ever become links", () => {
    expect(metaAdLink(ad())).toBe("https://www.facebook.com/ads/library/?id=1")
    expect(metaAdLink(ad({ adLibraryUrl: "javascript:alert(1)" }))).toBeNull()
    expect(metaAdLink(ad({ adLibraryUrl: 42 }))).toBeNull()
  })

  it("items are the array rows only", () => {
    expect(metaAdsScrapeItems([ad(), null, "x"])).toHaveLength(1)
    expect(metaAdsScrapeItems({ not: "an array" })).toEqual([])
  })

  it("never-ran → running → success, and the fingerprint marks edits as stale", () => {
    expect(deriveMetaAdsScrapeCardState(base).kind).toBe("never-ran")

    const started = { ...base, ...metaAdsScrapeRunStartPatch(base) } as MetaAdsScrapeNodeData
    expect(deriveMetaAdsScrapeCardState(started).kind).toBe("running")

    const done = { ...started, ...applyMetaAdsScrapeResult([ad(), ad({ adArchiveId: "2" })]) } as MetaAdsScrapeNodeData
    const ok = deriveMetaAdsScrapeCardState(done)
    expect(ok).toMatchObject({ kind: "success", count: 2, stale: false })

    const edited = { ...done, query: "sneakers" } as MetaAdsScrapeNodeData
    expect(deriveMetaAdsScrapeCardState(edited)).toMatchObject({ kind: "success", stale: true })
    expect(metaAdsScrapeFingerprint(edited)).not.toBe(metaAdsScrapeFingerprint(done))
  })

  it("card vocabulary: headline, initial, preview, domain, platforms, media, dates", () => {
    const full = ad({
      title: "",
      text: "First line of copy\nsecond line",
      caption: "",
      linkUrl: "https://www.nike.com/airmax",
      platforms: ["FACEBOOK", "INSTAGRAM", "THREADS"],
      images: [],
      videos: ["https://vid/1.mp4"],
      videoPreviews: ["https://vid/1.jpg"],
      startDate: "2026-08-27T07:00:00.000Z",
      endDate: "2026-09-17T07:00:00.000Z",
    })
    expect(metaAdHeadline(full)).toBe("First line of copy")
    expect(metaAdInitial(full)).toBe("N")
    expect(metaAdInitial(ad({ pageName: "" }))).toBe("?")
    expect(metaAdPreviewUrl(full)).toBe("https://vid/1.jpg")
    expect(metaAdPreviewUrl(ad({ videoPreviews: ["javascript:x"], images: ["https://img/2.jpg"] }))).toBe("https://img/2.jpg")
    expect(metaAdDomain(full)).toBe("nike.com")
    expect(metaAdDomain(ad({ caption: "shop.example" }))).toBe("shop.example")
    expect(metaAdPlatformLabel("AUDIENCE_NETWORK")).toBe("Audience Network")
    expect(metaAdPlatformsShort(full)).toBe("Facebook +2")
    expect(metaAdMediaCounts(full)).toEqual({ images: 0, videos: 1 })
    expect(metaAdDateRange(full)).toBe("Aug 27 → Sep 17")
    expect(metaAdDateRange(ad({ startDate: "2026-08-27T07:00:00.000Z", endDate: null }))).toBe("Aug 27 →")
    expect(metaAdRunDays(full)).toBe(21)
    expect(metaAdsActiveCount([ad({ isActive: true }), ad({ isActive: false }), ad({})])).toBe(1)
  })

  it("the featured index is clamped to the current payload and resets on a fresh success", () => {
    expect(clampFeaturedIndex(7, 3)).toBe(2)
    expect(clampFeaturedIndex(-1, 3)).toBe(0)
    expect(clampFeaturedIndex("x", 3)).toBe(0)
    expect(clampFeaturedIndex(1, 0)).toBe(0)
    expect(applyMetaAdsScrapeResult([ad()]).featuredIndex).toBe(0)
    expect(applyMetaAdsScrapeResult([])).not.toHaveProperty("featuredIndex")
  })

  it("the fingerprint tracks the platform filter (order-insensitive)", () => {
    const a = metaAdsScrapeFingerprint({ ...base, platforms: ["INSTAGRAM", "FACEBOOK"] })
    const b = metaAdsScrapeFingerprint({ ...base, platforms: ["FACEBOOK", "INSTAGRAM"] })
    const c = metaAdsScrapeFingerprint({ ...base, platforms: ["FACEBOOK"] })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it("an empty or failed rerun keeps the last good payload", () => {
    const good = { ...base, ...applyMetaAdsScrapeResult([ad()]) } as MetaAdsScrapeNodeData
    const empty = { ...good, ...applyMetaAdsScrapeResult([]) } as MetaAdsScrapeNodeData
    expect(empty.generatedJson).toEqual([ad()])
    expect(deriveMetaAdsScrapeCardState(empty)).toMatchObject({ kind: "empty", count: 0 })

    const failed = { ...good, ...applyMetaAdsScrapeFailure("blocked") } as MetaAdsScrapeNodeData
    expect(failed.generatedJson).toEqual([ad()])
    expect(deriveMetaAdsScrapeCardState(failed)).toMatchObject({ kind: "failed", errorMessage: "blocked", kept: { count: 1 } })
  })
})
