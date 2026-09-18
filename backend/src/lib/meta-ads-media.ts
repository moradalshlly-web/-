import {
  classifyAndStoreScrapedMedia,
  scrapedItemsWithoutMedia,
  type ScrapedCreative,
  type ScrapedItemMedia,
  type ScrapedMediaItem,
  type ScrapedMediaOptions,
  type ScrapedMediaStats,
} from "./scraped-media.js"
import type { MetaAd } from "../providers/apify/meta-ads.js"

/**
 * Meta-Ads adapter over the node-agnostic scraped-media step
 * (`lib/scraped-media.ts`): map a `MetaAd` onto the generic item shape, run
 * the shared classify → filter → store, and map the result back onto the ad
 * (durable urls swapped into `images` / `videos` / `videoPreviews`). All the
 * hard parts — the deadline, the format classifier, the quota short-circuit —
 * live in the shared module so Instagram / TikTok / LinkedIn reuse them.
 */

export type MetaAdCreative = ScrapedCreative

export interface MetaAdWithMedia extends MetaAd {
  /** The primary creative's format — first video (via its poster), else first image. */
  readonly format: ScrapedItemMedia["format"]
  readonly creatives: MetaAdCreative[]
}

export type MetaAdsMediaStats = ScrapedMediaStats
/** The scrape-specific options (the caller does not pass `source` / `filePrefix` — the adapter pins them). */
export type MetaAdsMediaOptions = Omit<ScrapedMediaOptions, "source" | "filePrefix">

const META_SOURCE = "meta-ads"
const META_FILE_PREFIX = "meta-ad"

function toScrapedItem(ad: MetaAd): ScrapedMediaItem {
  return {
    id: ad.adArchiveId,
    images: ad.images,
    videos: ad.videos.map((url, i) => ({ url, poster: ad.videoPreviews[i] ?? null })),
    sourceDetail: ad.pageName || undefined,
  }
}

/** Rebuild a MetaAd's media urls from the (possibly stored) creatives. */
function applyMedia(ad: MetaAd, media: ScrapedItemMedia): MetaAdWithMedia {
  const videos = media.creatives.filter((c) => c.kind === "video")
  const images = media.creatives.filter((c) => c.kind === "image")
  return {
    ...ad,
    images: images.map((c) => c.url),
    videos: videos.map((c) => c.url),
    videoPreviews: videos.map((c) => c.posterUrl).filter((u): u is string => !!u),
    format: media.format,
    creatives: media.creatives,
  }
}

/** The route's last resort when the media step itself throws: the ads as scraped, formats unknown, nothing stored. */
export function metaAdsWithoutMedia(ads: readonly MetaAd[]): MetaAdWithMedia[] {
  const media = scrapedItemsWithoutMedia(ads.map(toScrapedItem))
  return ads.map((ad, i) => applyMedia(ad, media[i]))
}

export async function classifyAndStoreMetaAdsMedia(
  ads: readonly MetaAd[],
  opts: MetaAdsMediaOptions,
): Promise<{ ads: MetaAdWithMedia[]; stats: MetaAdsMediaStats }> {
  const { items, keptIndexes, stats } = await classifyAndStoreScrapedMedia(ads.map(toScrapedItem), {
    ...opts,
    source: META_SOURCE,
    filePrefix: META_FILE_PREFIX,
  })
  return { ads: keptIndexes.map((adIndex, i) => applyMedia(ads[adIndex], items[i])), stats }
}
