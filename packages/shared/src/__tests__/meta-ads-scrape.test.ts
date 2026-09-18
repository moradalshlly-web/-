import { describe, it, expect } from "vitest"
import { LLM_FEATURE_DEFAULTS, STRUCTURED_VISION_MODELS, getLlmModel } from "../llm-models.js"
import {
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_ANALYSIS_TIERS,
  META_ADS_SCRAPE_CREDIT_COSTS,
  adCreativeAnalysisFrom,
  metaAdsAnalysisCreditId,
  metaAdsAnalysisTier,
  metaAdsScrapeCreditIdFromNode,
  META_ADS_SCRAPE_FALLBACK_CREDIT_ID,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_TIERS,
  buildMetaAdsScrapeCreditId,
  classifyCreativeFormat,
  clampMetaAdsFeaturedIndex,
  featuredMetaAdOutputs,
  isFacebookPageUrl,
  isMetaAdsScrapeCount,
  META_ADS_NODE_MODES,
  META_ADS_SCRAPE_MODES,
  metaAdsAdvertisersFrom,
  metaAdsNodeMode,
  splitMetaAdsAdvertiserNames,
  metaAdsScrapeSources,
  metaAdsScrapeTier,
  metaAdsScrapeWireSources,
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

  describe("per-ad AI analysis pricing (folded into the same identifier)", () => {
    it("the analysis SKU is tier × (1 + per-ad credits of the model's tier), and every combination is priced", () => {
      expect(buildMetaAdsScrapeCreditId({ count: 20, sources: 1, analysis: "standard" })).toBe("meta-ads-scrape:20:analysis")
      expect(buildMetaAdsScrapeCreditId({ count: 20, sources: 1, analysis: "economy" })).toBe("meta-ads-scrape:20:analysis:economy")
      expect(buildMetaAdsScrapeCreditId({ count: 30, sources: 2, analysis: "premium" })).toBe("meta-ads-scrape:100:analysis:premium")
      expect(buildMetaAdsScrapeCreditId({ count: 20, sources: 1, analysis: null })).toBe("meta-ads-scrape:20")
      for (const tier of META_ADS_SCRAPE_TIERS) {
        for (const a of META_ADS_ANALYSIS_TIERS) {
          const suffix = a === "standard" ? ":analysis" : `:analysis:${a}`
          const id = `meta-ads-scrape:${tier}${suffix}`
          expect(META_ADS_SCRAPE_CREDIT_COSTS[id], id).toBe(tier * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD[a]))
        }
      }
      // The per-ad settlement rows.
      expect(META_ADS_SCRAPE_CREDIT_COSTS[metaAdsAnalysisCreditId("economy")]).toBe(1)
      expect(META_ADS_SCRAPE_CREDIT_COSTS[metaAdsAnalysisCreditId("standard")]).toBe(3)
      expect(META_ADS_SCRAPE_CREDIT_COSTS[metaAdsAnalysisCreditId("premium")]).toBe(4)
      expect(metaAdsAnalysisCreditId("standard")).toBe("meta-ads-analysis")
      // Worked example the docs quote: 20 ads, economy model → 20 + 20 × 1 = 40.
      expect(META_ADS_SCRAPE_CREDIT_COSTS["meta-ads-scrape:20:analysis:economy"]).toBe(40)
    })

    it("the analysis tier follows the model; the default model is economy and image-capable with structured output", () => {
      expect(metaAdsAnalysisTier(undefined)).toBe("economy")
      expect(metaAdsAnalysisTier("claude-sonnet-4.6")).toBe("standard")
      expect(metaAdsAnalysisTier("claude-opus-5")).toBe("premium")
      const def = getLlmModel(LLM_FEATURE_DEFAULTS["meta-ads-analysis"])
      expect(def?.supportsImages).toBe(true)
      expect(def?.structuredOutputMode).toBeTruthy()
      expect(STRUCTURED_VISION_MODELS.some((m) => m.id === def?.id)).toBe(true)
    })

    it("metaAdsScrapeCreditIdFromNode: the ONE identifier a node's settings quote (also the wire resolver's answer)", () => {
      expect(metaAdsScrapeCreditIdFromNode({})).toBe("meta-ads-scrape:20")
      expect(metaAdsScrapeCreditIdFromNode({ mode: "search", count: 50, analyze: true })).toBe("meta-ads-scrape:50:analysis:economy")
      expect(metaAdsScrapeCreditIdFromNode({ mode: "pages", pageUrls: "a\nb", count: 30, analyze: true, analysisModel: "claude-sonnet-4.6" })).toBe("meta-ads-scrape:100:analysis")
      expect(metaAdsScrapeCreditIdFromNode({ mode: "search", count: 20, analyze: false, analysisModel: "claude-opus-5" })).toBe("meta-ads-scrape:20")
      // The wire resolver lands on the same SKU for the request the node would send.
      expect(resolveMetaAdsScrapeCreditId({ mode: "search", query: "x", count: 50, analyze: true })).toBe("meta-ads-scrape:50:analysis:economy")
      expect(resolveMetaAdsScrapeCreditId({ mode: "search", query: "x", analyze: true, analysisModel: "claude-opus-5" })).toBe("meta-ads-scrape:20:analysis:premium")
    })

    it("adCreativeAnalysisFrom reads a stored analysis defensively", () => {
      const raw = { assetType: "motion", format: "reel", visualHooks: ["face", 3, ""], audiences: [], graphicIdentity: "", copywritingHooks: ["urgency"], usps: [], cta: "Install", summary: "Sells an app." }
      expect(adCreativeAnalysisFrom(raw)).toEqual({ ...raw, visualHooks: ["face"] })
      expect(adCreativeAnalysisFrom({ ...raw, assetType: "gif" })?.assetType).toBe("unknown")
      expect(adCreativeAnalysisFrom({ ...raw, summary: "" })).toBeNull()
      expect(adCreativeAnalysisFrom(null)).toBeNull()
      expect(adCreativeAnalysisFrom("x")).toBeNull()
    })
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

  describe("advertiser mode (node-only; runs as pages)", () => {
    const openart = { pageId: "61562658466287", name: "OpenArt AI", url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/", imageUrl: "https://scontent.fbcdn.net/a.png", verified: true }
    const nike = { pageId: "15087023444", name: "Nike", url: "https://www.facebook.com/nike" }

    it("the wire modes stay search / pages; the node adds advertiser", () => {
      expect([...META_ADS_SCRAPE_MODES]).toEqual(["search", "pages"])
      expect([...META_ADS_NODE_MODES]).toEqual(["search", "pages", "advertiser"])
      expect(metaAdsNodeMode("advertiser")).toBe("advertiser")
      expect(metaAdsNodeMode("pages")).toBe("pages")
      expect(metaAdsNodeMode("nope")).toBe("search")
      expect(metaAdsNodeMode(undefined)).toBe("search")
    })

    it("metaAdsAdvertisersFrom sanitizes, dedupes by page id and caps at MAX_SOURCES", () => {
      expect(metaAdsAdvertisersFrom([openart, nike])).toEqual([openart, nike])
      expect(metaAdsAdvertisersFrom([openart, { ...openart, name: "dup" }])).toHaveLength(1)
      expect(metaAdsAdvertisersFrom([{ pageId: 15087023444, name: " Nike ", url: nike.url, imageUrl: "javascript:x", verified: "yes" }])).toEqual([nike])
      // An avatar is stored only from Meta's CDN — a workflow JSON anyone can write must not smuggle a third-party image in.
      expect(metaAdsAdvertisersFrom([{ ...nike, imageUrl: "https://evil.example/x.png?fbcdn.net" }])).toEqual([nike])
      expect(metaAdsAdvertisersFrom([{ ...nike, imageUrl: "https://scontent-atl3-1.xx.fbcdn.net/v/a.png" }])[0].imageUrl).toBe("https://scontent-atl3-1.xx.fbcdn.net/v/a.png")
      expect(metaAdsAdvertisersFrom([{ ...nike, pageId: Number.NaN }])).toEqual([])
      expect(metaAdsAdvertisersFrom([{ ...nike, url: `https://www.facebook.com/${"n".repeat(2100)}` }])).toEqual([])
      expect(metaAdsAdvertisersFrom([{ pageId: "1", name: "Elsewhere", url: "https://www.instagram.com/x" }])).toEqual([])
      expect(metaAdsAdvertisersFrom([{ pageId: "", name: "No id", url: nike.url }, { pageId: "2", name: "", url: nike.url }, null, "x"])).toEqual([])
      expect(metaAdsAdvertisersFrom("nope")).toEqual([])
      const many = Array.from({ length: 7 }, (_, i) => ({ pageId: String(i), name: `P${i}`, url: `https://www.facebook.com/p${i}` }))
      expect(metaAdsAdvertisersFrom(many)).toHaveLength(META_ADS_SCRAPE_MAX_SOURCES)
      expect(metaAdsAdvertisersFrom(many, 8)).toHaveLength(7) // lookup results may show more than the pick cap
      expect(isFacebookPageUrl("https://m.facebook.com/nike")).toBe(true)
      expect(isFacebookPageUrl("https://notfacebook.com/nike")).toBe(false)
      expect(isFacebookPageUrl("ftp://www.facebook.com/nike")).toBe(false)
    })

    it("metaAdsScrapeSources: the ONE source count every quote reads", () => {
      expect(metaAdsScrapeSources({})).toBe(1)
      expect(metaAdsScrapeSources({ mode: "search", query: "x" })).toBe(1)
      expect(metaAdsScrapeSources({ mode: "pages", pageUrls: "a\nb\nc" })).toBe(3)
      expect(metaAdsScrapeSources({ mode: "pages", pageUrls: "" })).toBe(1)
      expect(metaAdsScrapeSources({ mode: "pages", pageUrls: Array.from({ length: 9 }, (_, i) => `u${i}`) })).toBe(META_ADS_SCRAPE_MAX_SOURCES)
      expect(metaAdsScrapeSources({ mode: "advertiser", advertisers: [openart, nike] })).toBe(2)
      expect(metaAdsScrapeSources({ mode: "advertiser", advertisers: [] })).toBe(1)
      // A pages-mode node keeps its page count even if stale advertiser picks are around, and vice versa.
      expect(metaAdsScrapeSources({ mode: "pages", pageUrls: "a", advertisers: [openart, nike] })).toBe(1)
    })

    it("splitMetaAdsAdvertiserNames: one per line or comma, keeps spaces, dedupes, caps at MAX_SOURCES", () => {
      expect(splitMetaAdsAdvertiserNames("OpenArt AI\nNike, Adidas")).toEqual(["OpenArt AI", "Nike", "Adidas"])
      expect(splitMetaAdsAdvertiserNames("Nike\nnike\nNIKE")).toEqual(["Nike"]) // case-insensitive dedupe
      expect(splitMetaAdsAdvertiserNames("x")).toEqual([]) // under 2 chars
      expect(splitMetaAdsAdvertiserNames(["  Meta ", "", "Threads"])).toEqual(["Meta", "Threads"])
      expect(splitMetaAdsAdvertiserNames(Array.from({ length: 9 }, (_, i) => `Brand ${i}`))).toHaveLength(META_ADS_SCRAPE_MAX_SOURCES)
      expect(splitMetaAdsAdvertiserNames(undefined)).toEqual([])
    })

    it("metaAdsScrapeWireSources: advertiser picks run as their Page urls; the route never sees 'advertiser'", () => {
      expect(metaAdsScrapeWireSources({ mode: "advertiser", advertisers: [openart, nike] })).toEqual({ mode: "pages", pageUrls: [openart.url, nike.url] })
      // No picks + upstream text → the `in` value is advertiser NAME(s) to resolve at run time.
      expect(metaAdsScrapeWireSources({ mode: "advertiser", advertisers: [] }, "OpenArt AI, Nike")).toEqual({ mode: "pages", pageUrls: [], advertiserNames: ["OpenArt AI", "Nike"] })
      // No picks, no upstream → empty (the editor blocks the run before here).
      expect(metaAdsScrapeWireSources({ mode: "advertiser", advertisers: [] })).toEqual({ mode: "pages", pageUrls: [], advertiserNames: [] })
      // Picks win over upstream text.
      expect(metaAdsScrapeWireSources({ mode: "advertiser", advertisers: [nike] }, "OpenArt AI")).toEqual({ mode: "pages", pageUrls: [nike.url] })
      expect(metaAdsScrapeWireSources({ mode: "pages", pageUrls: "" }, "facebook.com/a, facebook.com/b")).toEqual({ mode: "pages", pageUrls: ["facebook.com/a", "facebook.com/b"] })
      expect(metaAdsScrapeWireSources({ mode: "pages", pageUrls: "https://www.facebook.com/own" }, "facebook.com/up")).toEqual({ mode: "pages", pageUrls: ["https://www.facebook.com/own"] })
      expect(metaAdsScrapeWireSources({ mode: "search", query: "" }, "shoes")).toEqual({ mode: "search", query: "shoes" })
      expect(metaAdsScrapeWireSources({ mode: "search", query: "own" }, "shoes")).toEqual({ mode: "search", query: "own" })
      expect(metaAdsScrapeWireSources({})).toEqual({ mode: "search", query: undefined })
    })
  })

  describe("resolveMetaAdsScrapeCreditId (raw, pre-Zod body)", () => {
    it("reads mode + count + pageUrls", () => {
      expect(resolveMetaAdsScrapeCreditId({ mode: "search", query: "nike", count: 50 })).toBe("meta-ads-scrape:50")
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: ["a", "b"], count: 30 })).toBe("meta-ads-scrape:100")
    })

    it("counts advertiser names as sources (they resolve to Page urls at run time)", () => {
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: [], advertiserNames: ["OpenArt AI", "Nike"], count: 30 })).toBe("meta-ads-scrape:100")
      expect(resolveMetaAdsScrapeCreditId({ mode: "pages", pageUrls: ["a"], advertiserNames: ["Nike"], count: 20 })).toBe("meta-ads-scrape:50") // (1+1)×20=40→50 tier
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
