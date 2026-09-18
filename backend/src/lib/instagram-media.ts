import {
  classifyAndStoreScrapedMedia,
  scrapedItemsWithoutMedia,
  type ScrapedCreative,
  type ScrapedItemMedia,
  type ScrapedMediaItem,
  type ScrapedMediaOptions,
  type ScrapedMediaStats,
} from "./scraped-media.js"
import { instagramKnownDims, type InstagramPost } from "../providers/apify/instagram.js"

/**
 * Instagram adapter over the node-agnostic scraped-media step. Instagram post
 * media (`cdninstagram.com` / `fbcdn.net`) is signed and short-lived exactly
 * like Meta's, so the node copies it into the user's library at scrape time;
 * posts report pixel dimensions, so `knownDims` lets the classify + format
 * filter skip a probe fetch.
 */

export type InstagramCreative = ScrapedCreative

export interface InstagramPostWithMedia extends InstagramPost {
  readonly format: ScrapedItemMedia["format"]
  readonly creatives: InstagramCreative[]
}

export type InstagramMediaStats = ScrapedMediaStats
export type InstagramMediaOptions = Omit<ScrapedMediaOptions, "source" | "filePrefix">

const IG_SOURCE = "instagram"
const IG_FILE_PREFIX = "ig-post"

function toScrapedItem(post: InstagramPost): ScrapedMediaItem {
  return {
    id: post.postId,
    images: post.images,
    videos: post.videos.map((url, i) => ({ url, poster: post.videoPreviews[i] ?? null })),
    knownDims: instagramKnownDims(post),
    sourceDetail: post.ownerUsername || undefined,
  }
}

function applyMedia(post: InstagramPost, media: ScrapedItemMedia): InstagramPostWithMedia {
  const videos = media.creatives.filter((c) => c.kind === "video")
  const images = media.creatives.filter((c) => c.kind === "image")
  return {
    ...post,
    images: images.map((c) => c.url),
    videos: videos.map((c) => c.url),
    videoPreviews: videos.map((c) => c.posterUrl).filter((u): u is string => !!u),
    format: media.format,
    creatives: media.creatives,
  }
}

export function instagramWithoutMedia(posts: readonly InstagramPost[]): InstagramPostWithMedia[] {
  const media = scrapedItemsWithoutMedia(posts.map(toScrapedItem))
  return posts.map((post, i) => applyMedia(post, media[i]))
}

export async function classifyAndStoreInstagramMedia(
  posts: readonly InstagramPost[],
  opts: InstagramMediaOptions,
): Promise<{ posts: InstagramPostWithMedia[]; stats: InstagramMediaStats }> {
  const { items, keptIndexes, stats } = await classifyAndStoreScrapedMedia(posts.map(toScrapedItem), {
    ...opts,
    source: IG_SOURCE,
    filePrefix: IG_FILE_PREFIX,
  })
  return { posts: keptIndexes.map((postIndex, i) => applyMedia(posts[postIndex], items[i])), stats }
}
