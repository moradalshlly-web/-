/**
 * Instagram scraper node — shared vocabulary + credit identifiers.
 *
 * Pulls PUBLIC Instagram posts (feed images, carousels, reels) by profile or
 * by hashtag and emits a normalized JSON array. Same shape of contract as the
 * Meta Ads node: everything the backend guard/reservation, the frontend credit
 * badge and the docs formula must agree on lives here.
 *
 * Pricing: 1 credit per REQUESTED post, rounded UP to a fixed tier of
 * `count × sources` (a profile / hashtag is one source, up to 5). Optional
 * per-post AI analysis folds into the same identifier, priced by the model's
 * tier — reusing the Meta analysis per-item values so the two nodes stay in
 * lockstep.
 */
import {
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_ANALYSIS_TIERS,
  metaAdsAnalysisTier,
  type MetaAdsAnalysisTier,
} from "./meta-ads-scrape.js"
import { classifyCreativeFormat, type MetaAdsFormat } from "./meta-ads-scrape.js"

export const INSTAGRAM_SCRAPE_NODE_TYPE = "instagram-scrape" as const

export const INSTAGRAM_SCRAPE_MODES = ["profile", "hashtag"] as const
export type InstagramScrapeMode = (typeof INSTAGRAM_SCRAPE_MODES)[number]

export function isInstagramScrapeMode(value: unknown): value is InstagramScrapeMode {
  return typeof value === "string" && (INSTAGRAM_SCRAPE_MODES as readonly string[]).includes(value)
}
export function instagramScrapeMode(value: unknown): InstagramScrapeMode {
  return isInstagramScrapeMode(value) ? value : "profile"
}

/** Same window vocabulary as Meta Ads; the Instagram actor honours it server-side (`onlyPostsNewerThan`). */
export const INSTAGRAM_SCRAPE_PERIODS = ["24h", "7d", "30d", "all"] as const
export type InstagramScrapePeriod = (typeof INSTAGRAM_SCRAPE_PERIODS)[number]

export const INSTAGRAM_SCRAPE_DEFAULT_COUNT = 20
export const INSTAGRAM_SCRAPE_MAX_COUNT = 100
export const INSTAGRAM_SCRAPE_MAX_SOURCES = 5
/** Instagram usernames / hashtags are short; cap a single target well under a URL. */
export const INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH = 200

/** Requested-total buckets — identical shape to Meta (the pricing model is the same). */
export const INSTAGRAM_SCRAPE_TIERS = [10, 20, 50, 100, 200, 500] as const
export type InstagramScrapeTier = (typeof INSTAGRAM_SCRAPE_TIERS)[number]

export function instagramScrapeTier(requestedTotal: number): InstagramScrapeTier {
  for (const tier of INSTAGRAM_SCRAPE_TIERS) if (requestedTotal <= tier) return tier
  return INSTAGRAM_SCRAPE_TIERS[INSTAGRAM_SCRAPE_TIERS.length - 1]
}

/** The analysis tier a request / node asks for, or null when analysis is off. */
export function instagramAnalysisTierFrom(data: { readonly analyze?: unknown; readonly analysisModel?: unknown }): MetaAdsAnalysisTier | null {
  return data.analyze === true ? metaAdsAnalysisTier(data.analysisModel) : null
}

function analysisSuffix(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? ":analysis" : `:analysis:${tier}`
}

/** Per-post settlement SKU for a tier (the bare id is the standard tier). */
export const INSTAGRAM_ANALYSIS_CREDIT_ID = "instagram-analysis" as const
export function instagramAnalysisCreditId(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? INSTAGRAM_ANALYSIS_CREDIT_ID : `${INSTAGRAM_ANALYSIS_CREDIT_ID}:${tier}`
}

export interface InstagramScrapeCreditInput {
  count: number
  sources: number
  analysis?: MetaAdsAnalysisTier | null
}

export function buildInstagramScrapeCreditId(input: InstagramScrapeCreditInput): string {
  const sources = Math.min(Math.max(Math.trunc(input.sources) || 1, 1), INSTAGRAM_SCRAPE_MAX_SOURCES)
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), INSTAGRAM_SCRAPE_MAX_COUNT)
  const base = `${INSTAGRAM_SCRAPE_NODE_TYPE}:${instagramScrapeTier(count * sources)}`
  return input.analysis ? `${base}${analysisSuffix(input.analysis)}` : base
}

/**
 * Cost per SKU — mirror of the backend `STATIC_CREDIT_COSTS` rows / migration,
 * for the frontend badge / estimator. 1 credit per requested post at every
 * tier, plus the analysis multiples.
 */
export const INSTAGRAM_SCRAPE_CREDIT_COSTS: Record<string, number> = (() => {
  const table: Record<string, number> = { [INSTAGRAM_SCRAPE_NODE_TYPE]: 20 }
  for (const tier of META_ADS_ANALYSIS_TIERS) table[instagramAnalysisCreditId(tier)] = META_ADS_ANALYSIS_CREDITS_PER_AD[tier]
  for (const t of INSTAGRAM_SCRAPE_TIERS) {
    table[`${INSTAGRAM_SCRAPE_NODE_TYPE}:${t}`] = t
    for (const tier of META_ADS_ANALYSIS_TIERS) {
      table[`${INSTAGRAM_SCRAPE_NODE_TYPE}:${t}${analysisSuffix(tier)}`] = t * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD[tier])
    }
  }
  return table
})()

export const INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID = "instagram-scrape:20"

export function isInstagramScrapeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= INSTAGRAM_SCRAPE_MAX_COUNT
}

/**
 * Targets (profile usernames/URLs or hashtags) are typed one per line; the
 * route wants an array. Unlike page urls a target can be a bare username /
 * `#tag`, so split on lines / commas only (never whitespace), strip a leading
 * `@` or `#`, dedupe, cap at MAX_SOURCES.
 */
export function splitInstagramTargets(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const t = item.trim().replace(/^[@#]+/, "").trim()
    if (t.length < 1 || t.length > INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= INSTAGRAM_SCRAPE_MAX_SOURCES) break
  }
  return out
}

/** The featured post index, clamped. */
export function clampInstagramFeaturedIndex(stored: unknown, count: number): number {
  if (count <= 0) return 0
  const n = typeof stored === "number" && Number.isFinite(stored) ? Math.trunc(stored) : 0
  return Math.min(Math.max(n, 0), count - 1)
}

export interface FeaturedInstagramOutputs {
  readonly text?: string
  readonly imageUrl?: string
  readonly videoUrl?: string
}

function urlStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []
}

/** The featured post's caption (`text`), first image / cover (`image`), and first video (`video`). */
export function featuredInstagramOutputs(json: unknown, featuredIndex: unknown): FeaturedInstagramOutputs {
  if (!Array.isArray(json) || json.length === 0) return {}
  const post = json[clampInstagramFeaturedIndex(featuredIndex, json.length)]
  if (!post || typeof post !== "object") return {}
  const p = post as Record<string, unknown>
  const text = typeof p.caption === "string" ? p.caption.trim() : ""
  const imageUrl = urlStrings(p.images)[0] ?? urlStrings(p.videoPreviews)[0]
  const videoUrl = urlStrings(p.videos)[0]
  return {
    ...(text ? { text } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
  }
}

/** The node-data fields a quote reads. */
export interface InstagramNodeQuoteFields {
  readonly [key: string]: unknown
  readonly mode?: unknown
  readonly targets?: unknown
  readonly count?: unknown
  readonly analyze?: unknown
  readonly analysisModel?: unknown
}

/** Billable source count: number of targets (min 1). */
export function instagramScrapeSources(data: InstagramNodeQuoteFields): number {
  return Math.max(1, Math.min(splitInstagramTargets(data.targets).length, INSTAGRAM_SCRAPE_MAX_SOURCES))
}

/** The ONE credit identifier for a node's current settings. */
export function instagramScrapeCreditIdFromNode(data: InstagramNodeQuoteFields): string {
  const count = typeof data.count === "number" ? data.count : INSTAGRAM_SCRAPE_DEFAULT_COUNT
  return buildInstagramScrapeCreditId({ count, sources: instagramScrapeSources(data), analysis: instagramAnalysisTierFrom(data) })
}

/**
 * Resolve the credit identifier from an UNVALIDATED request body (the guard
 * runs before Zod). Lands on the SAME tier the reservation computes.
 */
export function resolveInstagramScrapeCreditId(body: unknown): string {
  const raw = body as { count?: unknown; targets?: unknown; analyze?: unknown; analysisModel?: unknown } | null | undefined
  if (!raw || typeof raw !== "object") return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  const count = raw.count === undefined ? INSTAGRAM_SCRAPE_DEFAULT_COUNT : raw.count
  if (!isInstagramScrapeCount(count)) return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  // Same splitter the handler uses for `sources` (dedupes, caps at MAX), so the
  // pre-Zod guard and the post-Zod reservation always land on the same tier —
  // a duplicate target bills once, not per copy.
  const sources = splitInstagramTargets(raw.targets).length
  if (sources < 1) return INSTAGRAM_SCRAPE_FALLBACK_CREDIT_ID
  return buildInstagramScrapeCreditId({ count, sources, analysis: instagramAnalysisTierFrom(raw) })
}

// Re-export the shared creative-format vocabulary so the node imports one place.
export { classifyCreativeFormat }
export type InstagramFormat = MetaAdsFormat
