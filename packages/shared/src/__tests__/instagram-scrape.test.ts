import { describe, it, expect } from "vitest"
import {
  INSTAGRAM_SCRAPE_CREDIT_COSTS,
  INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID,
  INSTAGRAM_SCRAPE_MAX_SOURCES,
  INSTAGRAM_SCRAPE_TIERS,
  buildInstagramScrapeCreditId,
  clampInstagramFeaturedIndex,
  featuredInstagramOutputs,
  instagramScrapeCreditIdFromNode,
  instagramScrapeSources,
  resolveInstagramScrapeCreditId,
  splitInstagramTargets,
} from "../instagram-scrape.js"
import { resolveEffectiveSourceType } from "../entity-image-handle.js"

describe("instagram-scrape vocabulary", () => {
  it("splitInstagramTargets: one per line / comma, strips @ and #, dedupes, caps at MAX_SOURCES", () => {
    expect(splitInstagramTargets("@nike\n#running, adidas")).toEqual(["nike", "running", "adidas"])
    expect(splitInstagramTargets("nike\nNIKE")).toEqual(["nike"])
    expect(splitInstagramTargets(["  puma ", "", "@vans"])).toEqual(["puma", "vans"])
    expect(splitInstagramTargets(Array.from({ length: 9 }, (_, i) => `b${i}`))).toHaveLength(INSTAGRAM_SCRAPE_MAX_SOURCES)
    expect(splitInstagramTargets(undefined)).toEqual([])
  })

  it("credit ids: 1 credit per requested post, tiered on count × sources, analysis folds in", () => {
    expect(buildInstagramScrapeCreditId({ count: 20, sources: 1 })).toBe("instagram-scrape:20")
    expect(buildInstagramScrapeCreditId({ count: 30, sources: 2 })).toBe("instagram-scrape:100")
    expect(buildInstagramScrapeCreditId({ count: 20, sources: 1, analysis: "economy" })).toBe("instagram-scrape:20:analysis:economy")
    expect(buildInstagramScrapeCreditId({ count: 50, sources: 1, analysis: "standard" })).toBe("instagram-scrape:50:analysis")
    for (const tier of INSTAGRAM_SCRAPE_TIERS) {
      expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[`instagram-scrape:${tier}`]).toBe(tier)
      expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[`instagram-scrape:${tier}:analysis:economy`]).toBe(tier * 2)
    }
    expect(INSTAGRAM_SCRAPE_CREDIT_COSTS[INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID]).toBeDefined()
  })

  it("the node quote and the pre-Zod guard land on the SAME identifier", () => {
    const data = { mode: "profile", targets: "nike\nadidas", count: 30, analyze: true }
    expect(instagramScrapeSources(data)).toBe(2)
    expect(instagramScrapeCreditIdFromNode(data)).toBe("instagram-scrape:100:analysis:economy")
    // The wire body the node sends (targets already split to an array).
    expect(resolveInstagramScrapeCreditId({ targets: ["nike", "adidas"], count: 30, analyze: true })).toBe("instagram-scrape:100:analysis:economy")
    expect(resolveInstagramScrapeCreditId({})).toBe("instagram-scrape:20") // omitted count = default, 1 source
  })

  it("featured outputs: caption / first image / first video, clamped", () => {
    const posts = [
      { caption: "hi", images: ["https://i/1.jpg"], videos: [], videoPreviews: [] },
      { caption: "vid", images: [], videos: ["https://v/2.mp4"], videoPreviews: ["https://v/2.jpg"] },
    ]
    expect(featuredInstagramOutputs(posts, 0)).toEqual({ text: "hi", imageUrl: "https://i/1.jpg" })
    expect(featuredInstagramOutputs(posts, 1)).toEqual({ text: "vid", imageUrl: "https://v/2.jpg", videoUrl: "https://v/2.mp4" })
    expect(featuredInstagramOutputs(posts, 9)).toEqual(featuredInstagramOutputs(posts, 1))
    expect(featuredInstagramOutputs([], 0)).toEqual({})
    expect(clampInstagramFeaturedIndex(-3, 2)).toBe(0)
  })

  it("typed handles resolve as the canonical single-media producers on canvas; json keeps the raw type", () => {
    expect(resolveEffectiveSourceType("instagram-scrape", "text")).toBe("combine-text")
    expect(resolveEffectiveSourceType("instagram-scrape", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("instagram-scrape", "video")).toBe("upload-video")
    expect(resolveEffectiveSourceType("instagram-scrape", "json")).toBe("instagram-scrape")
    expect(resolveEffectiveSourceType("instagram-scrape", "audio")).toBe("instagram-scrape")
  })
})
