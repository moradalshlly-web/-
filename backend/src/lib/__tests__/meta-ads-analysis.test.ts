/**
 * The Meta-shaped adapter over the generic analysis: which frame the model
 * sees, which facts ride along, and where the answer lands on each ad.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../llm-client.js", () => ({ llmCompleteStructured: vi.fn() }))

import { analyzeMetaAds, metaAdAnalysisImage, metaAdToCreativeItem } from "../meta-ads-analysis.js"
import type { MetaAdWithMedia } from "../meta-ads-media.js"

function ad(over: Partial<MetaAdWithMedia> = {}): MetaAdWithMedia {
  return {
    adArchiveId: "1",
    adLibraryUrl: "https://www.facebook.com/ads/library/?id=1",
    pageName: "Nike",
    pageId: "15087023444",
    startDate: null,
    endDate: null,
    isActive: true,
    platforms: ["FACEBOOK", "INSTAGRAM"],
    text: "Just do it.",
    title: "Air Max",
    caption: "nike.com",
    ctaText: "Shop now",
    linkUrl: "https://www.nike.com/airmax?utm=x",
    images: ["https://cdn.nodaro.ai/images/a.jpg"],
    videos: [],
    videoPreviews: [],
    collationCount: 1,
    format: "square",
    creatives: [],
    ...over,
  } as MetaAdWithMedia
}

describe("metaAdToCreativeItem", () => {
  it("a video ad shows its poster frame, an image ad its first image; the facts are the ad's copy", () => {
    expect(metaAdAnalysisImage(ad())).toBe("https://cdn.nodaro.ai/images/a.jpg")
    expect(metaAdAnalysisImage(ad({ videos: ["https://cdn/v.mp4"], videoPreviews: ["https://cdn.nodaro.ai/images/poster.jpg"] }))).toBe("https://cdn.nodaro.ai/images/poster.jpg")
    expect(metaAdToCreativeItem(ad(), "our shoes are cheaper")).toEqual({
      id: "1",
      imageUrl: "https://cdn.nodaro.ai/images/a.jpg",
      advertiser: "Nike",
      headline: "Air Max",
      body: "Just do it.",
      ctaLabel: "Shop now",
      landing: "nike.com",
      platforms: ["FACEBOOK", "INSTAGRAM"],
      creativeFormat: "square",
      mediaSummary: "1 image",
      focus: "our shoes are cheaper",
    })
    expect(metaAdToCreativeItem(ad({ format: "unknown", linkUrl: "", caption: "shop.example" })).creativeFormat).toBeUndefined()
    expect(metaAdToCreativeItem(ad({ linkUrl: "not a url", caption: "shop.example" })).landing).toBe("shop.example")
  })
})

describe("analyzeMetaAds", () => {
  it("attaches the analysis to each ad by archive id, null + reason when it was not analysed", async () => {
    const analysis = { assetType: "static", format: "in-feed", visualHooks: [], audiences: [], graphicIdentity: "", copywritingHooks: [], usps: [], cta: "Shop now", summary: "ok" }
    const complete = vi.fn().mockResolvedValueOnce({ output: analysis, inputTokens: 1, outputTokens: 1, providerCost: 0.001 }).mockRejectedValueOnce(new Error("nope"))
    const { ads, stats } = await analyzeMetaAds([ad({ adArchiveId: "1" }), ad({ adArchiveId: "2" })], {
      modelId: "gemini-3.6-flash",
      deadlineAt: Date.now() + 60_000,
      concurrency: 1,
      complete: complete as never,
    })
    expect(ads[0].analysis).toEqual(analysis)
    expect(ads[0].analysisSkipped).toBeUndefined()
    expect(ads[1].analysis).toBeNull()
    expect(ads[1].analysisSkipped).toBe("failed")
    expect(ads[1].pageName).toBe("Nike") // the ad itself is untouched
    expect(stats).toMatchObject({ requested: 2, analyzed: 1, failed: 1 })
  })
})
