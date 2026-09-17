import { describe, it, expect } from "vitest"
import {
  META_ADS_SCRAPE_CREDIT_COSTS,
  META_ADS_SCRAPE_FALLBACK_CREDIT_ID,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_TIERS,
  buildMetaAdsScrapeCreditId,
  classifyCreativeFormat,
  clampMetaAdsFeaturedIndex,
  featuredMetaAdOutputs,
  isMetaAdsScrapeCount,
  metaAdsScrapeTier,
  resolveMetaAdsScrapeCreditId,
  splitMetaAdsPageUrls,
} from "../meta-ads-scrape.js"
import { resolveEffectiveSourceType } from "../entity-image-handle.js"

describe("meta-ads-scrape credit identifiers", () => {
  it("the top tier is exactly the Zod ceiling (max count × max sources)", () => {
    expect(META_ADS_SCRAPE_TIERS[META_ADS_SCRAPE_TIERS.length - 1]).toBe(
      META_ADS_SCRAPE_MAX_COUNT * META_ADS_SCRAPE_MAX_SOURCES,
    )
  })

  it("buckets a requested total to the smallest tier that fits", () => {
    expect(metaAdsScrapeTier(1)).toBe(10)
    expect(metaAdsScrapeTier(10)).toBe(10)
    expect(metaAdsScrapeTier(11)).toBe(20)
    expect(metaAdsScrapeTier(20)).toBe(20)
    expect(metaAdsScrapeTier(21)).toBe(50)
    expect(metaAdsScrapeTier(100)).toBe(100)
    expect(metaAdsScrapeTier(101)).toBe(200)
    expect(metaAdsScrapeTier(500)).toBe(500)
    expect(metaAdsScrapeTier(9_999)).toBe(500)
  })

  it("search = one source; pages multiply by URL count", () => {
    expect(buildMetaAdsScrapeCreditId({ count: 20, sources: 1 })).toBe("meta-ads-scrape:20")
    expect(buildMetaAdsScrapeCreditId({ count: 20, sources: 3 })).toBe("meta-ads-scrape:100")
    expect(buildMetaAdsScrapeCreditId({ count: 100, sources: 5 })).toBe("meta-ads-scrape:500")
  })

  it("clamps out-of-range count / sources instead of producing an unpriced id", () => {
    expect(buildMetaAdsScrapeCreditId({ count: 1_000, sources: 50 })).toBe("meta-ads-scrape:500")
    expect(buildMetaAdsScrapeCreditId({ count: 0, sources: 0 })).toBe("meta-ads-scrape:10")
  })

  it("every id the builder can produce is priced (1 credit per requested ad)", () => {
    for (const tier of META_ADS_SCRAPE_TIERS) {
      expect(META_ADS_SCRAPE_CREDIT_COSTS[`meta-ads-scrape:${tier}`]).toBe(tier)
    }
    expect(META_ADS_SCRAPE_CREDIT_COSTS["meta-ads-scrape"]).toBe(20)
    expect(META_ADS_SCRAPE_CREDIT_COSTS[META_ADS_SCRAPE_FALLBACK_CREDIT_ID]).toBeDefined()
  })

  it("featuredMetaAdOutputs: the featured ad's copy, first image (else poster) and first video", () => {
    const ads = [
      { title: "Air Max", text: "Just do it.", images: ["https://img/1.jpg"], videos: [], videoPreviews: [] },
      { title: "", text: "Video ad", images: [], videos: ["https://vid/2.mp4"], videoPreviews: ["https://vid/2.jpg"] },
    ]
    expect(featuredMetaAdOutputs(ads, 0)).toEqual({ text: "Air Max\n\nJust do it.", imageUrl: "https://img/1.jpg" })
    expect(featuredMetaAdOutputs(ads, 1)).toEqual({ text: "Video ad", imageUrl: "https://vid/2.jpg", videoUrl: "https://vid/2.mp4" })
    expect(featuredMetaAdOutputs(ads, 99)).toEqual(featuredMetaAdOutputs(ads, 1)) // clamped
    expect(featuredMetaAdOutputs([], 0)).toEqual({})
    expect(featuredMetaAdOutputs("nope", 0)).toEqual({})
    expect(clampMetaAdsFeaturedIndex(-3, 2)).toBe(0)
  })

  it("the typed output handles behave as the canonical single-media producers on canvas; json keeps the raw type", () => {
    expect(resolveEffectiveSourceType("meta-ads-scrape", "text")).toBe("combine-text")
    expect(resolveEffectiveSourceType("meta-ads-scrape", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("meta-ads-scrape", "video")).toBe("upload-video")
    expect(resolveEffectiveSourceType("meta-ads-scrape", "json")).toBe("meta-ads-scrape")
    expect(resolveEffectiveSourceType("meta-ads-scrape", undefined)).toBe("meta-ads-scrape")
    // Not a dynamic producer: an audio input must never accept it.
    expect(resolveEffectiveSourceType("meta-ads-scrape", "audio")).toBe("meta-ads-scrape")
  })

  it("classifyCreativeFormat: vertical below 0.95, square within ±5 %, horizontal above, unknown without pixels", () => {
    expect(classifyCreativeFormat(1080, 1920)).toBe("vertical") // 9:16
    expect(classifyCreativeFormat(1080, 1350)).toBe("vertical") // 4:5
    expect(classifyCreativeFormat(1080, 1080)).toBe("square")
    expect(classifyCreativeFormat(1000, 960)).toBe("square") // 1.04
    expect(classifyCreativeFormat(1920, 1080)).toBe("horizontal") // 16:9
    expect(classifyCreativeFormat(1200, 628)).toBe("horizontal") // 1.91:1
    expect(classifyCreativeFormat(0, 100)).toBe("unknown")
    expect(classifyCreativeFormat(undefined, 100)).toBe("unknown")
    expect(classifyCreativeFormat(Number.NaN, 100)).toBe("unknown")
  })

  it("splitMetaAdsPageUrls accepts one-per-line text, commas, or an array", () => {
    expect(splitMetaAdsPageUrls("https://www.facebook.com/nike\n facebook.com/adidas ,https://facebook.com/puma\n\n")).toEqual([
      "https://www.facebook.com/nike",
      "facebook.com/adidas",
      "https://facebook.com/puma",
    ])
    expect(splitMetaAdsPageUrls(["a", " b ", "", 3])).toEqual(["a", "b"])
    expect(splitMetaAdsPageUrls(undefined)).toEqual([])
    expect(splitMetaAdsPageUrls("")).toEqual([])
  })

  it("isMetaAdsScrapeCount accepts 1..100 integers only", () => {
    expect(isMetaAdsScrapeCount(1)).toBe(true)
    expect(isMetaAdsScrapeCount(100)).toBe(true)
    expect(isMetaAdsScrapeCount(0)).toBe(false)
    expect(isMetaAdsScrapeCount(101)).toBe(false)
    expect(isMetaAdsScrapeCount(2.5)).toBe(false)
    expect(isMetaAdsScrapeCount("20")).toBe(false)
  })

  describe("resolveMetaAdsScrapeCreditId (raw, pre-Zod body)", () => {
    it("reads mode + count + pageUrls", () => {
      expect(resolveMetaAdsScrapeCreditId({ mode: "search", query: "nike", count: 50 })).toBe("meta-ads-scrape:50")
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: ["a", "b"], count: 30 })).toBe("meta-ads-scrape:100")
    })

    it("an OMITTED count is the route default, so the guard lands on the reservation's tier", () => {
      // Zod defaults count to 20 and the reservation multiplies by sources —
      // the guard must not reserve the flat fallback for a 3-page body.
      expect(resolveMetaAdsScrapeCreditId({ mode: "search", query: "x" })).toBe("meta-ads-scrape:20")
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: ["a", "b", "c"] })).toBe("meta-ads-scrape:100")
    })

    it("falls back to the fixed mid tier on a malformed body", () => {
      expect(resolveMetaAdsScrapeCreditId(undefined)).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId(null)).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId({ count: "20" })).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId({ count: 0 })).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", count: 20 })).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: [], count: 20 })).toBe(META_ADS_SCRAPE_FALLBACK_CREDIT_ID)
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: new Array(6).fill("u"), count: 20 })).toBe(
        META_ADS_SCRAPE_FALLBACK_CREDIT_ID,
      )
    })

    it("the fallback is a mid tier, never the max", () => {
      const max = META_ADS_SCRAPE_TIERS[META_ADS_SCRAPE_TIERS.length - 1]
      expect(META_ADS_SCRAPE_CREDIT_COSTS[META_ADS_SCRAPE_FALLBACK_CREDIT_ID]).toBeLessThan(max)
    })
  })
})
