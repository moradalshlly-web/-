/**
 * Meta Ads scraper node — shared vocabulary + credit identifiers.
 *
 * The node pulls PUBLIC ads (Facebook + Instagram placements) out of Meta's
 * Ad Library, either by keyword search or by Facebook Page URL, and emits a
 * JSON array of normalized ads. Everything the backend guard/reservation, the
 * frontend credit badge and the docs formula must agree on lives here so the
 * three cannot drift apart.
 *
 * Pricing shape: 1 credit per REQUESTED ad, rounded UP to a fixed tier. The
 * requested total is `count × sources` (search = 1 source; pages = one per
 * URL). The route's Zod bounds `count ≤ 100` and `sources ≤ 5`, so the total
 * can never land outside the tier set — an identifier missing from
 * `model_pricing` is a 503 `price_not_configured`, never a silent fallback.
 */
export const META_ADS_SCRAPE_NODE_TYPE = "meta-ads-scrape" as const

export const META_ADS_SCRAPE_MODES = ["search", "pages"] as const
export type MetaAdsScrapeMode = (typeof META_ADS_SCRAPE_MODES)[number]

export const META_ADS_SCRAPE_PERIODS = ["24h", "7d", "30d", "all"] as const
export type MetaAdsScrapePeriod = (typeof META_ADS_SCRAPE_PERIODS)[number]

export const META_ADS_SCRAPE_STATUSES = ["active", "inactive", "all"] as const
export type MetaAdsScrapeStatus = (typeof META_ADS_SCRAPE_STATUSES)[number]

/** Meta's `publisher_platform` vocabulary — the values an ad's `platforms` carries and the filter the node accepts. */
export const META_ADS_PLATFORMS = ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", "MESSENGER", "WHATSAPP", "THREADS"] as const
export type MetaAdsPlatform = (typeof META_ADS_PLATFORMS)[number]

export function isMetaAdsPlatform(value: unknown): value is MetaAdsPlatform {
  return typeof value === "string" && (META_ADS_PLATFORMS as readonly string[]).includes(value)
}

/** Presets the config panel offers; the route accepts any integer 1..MAX_COUNT. */
export const META_ADS_SCRAPE_COUNT_OPTIONS = [10, 20, 50, 100] as const
export const META_ADS_SCRAPE_DEFAULT_COUNT = 20
export const META_ADS_SCRAPE_MAX_COUNT = 100
export const META_ADS_SCRAPE_MAX_SOURCES = 5
/** Meta caps Ad Library search terms at 100 characters. */
export const META_ADS_SCRAPE_MAX_QUERY_LENGTH = 100
export const META_ADS_SCRAPE_DEFAULT_COUNTRY = "ALL"

/** Requested-total buckets. Sorted ascending; the last one is `MAX_COUNT × MAX_SOURCES`. */
export const META_ADS_SCRAPE_TIERS = [10, 20, 50, 100, 200, 500] as const
export type MetaAdsScrapeTier = (typeof META_ADS_SCRAPE_TIERS)[number]

/**
 * Credit cost per composite SKU — mirror of the backend `STATIC_CREDIT_COSTS`
 * rows for the frontend badge / estimator. 1 credit per requested ad at every
 * tier; the bare identifier is the pre-Zod fallback (mid tier, never the max).
 */
export const META_ADS_SCRAPE_CREDIT_COSTS: Record<string, number> = {
  "meta-ads-scrape": 20,
  "meta-ads-scrape:10": 10,
  "meta-ads-scrape:20": 20,
  "meta-ads-scrape:50": 50,
  "meta-ads-scrape:100": 100,
  "meta-ads-scrape:200": 200,
  "meta-ads-scrape:500": 500,
}

export const META_ADS_SCRAPE_FALLBACK_CREDIT_ID = "meta-ads-scrape:20"

/**
 * Page urls are typed one per line in the config panel (a FieldMapping
 * injects the same text); the route wants an array. Tolerates commas and
 * whitespace as separators (a url never contains either) and an array that
 * already went through this once.
 */
export function splitMetaAdsPageUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v.length > 0)
  }
  if (typeof value !== "string") return []
  return value.split(/[\n,\s]+/).map((v) => v.trim()).filter((v) => v.length > 0)
}

export function isMetaAdsScrapeMode(value: unknown): value is MetaAdsScrapeMode {
  return typeof value === "string" && (META_ADS_SCRAPE_MODES as readonly string[]).includes(value)
}

export function isMetaAdsScrapeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= META_ADS_SCRAPE_MAX_COUNT
}

/** Smallest tier that fits the requested total; clamps to the top tier. */
export function metaAdsScrapeTier(requestedTotal: number): MetaAdsScrapeTier {
  for (const tier of META_ADS_SCRAPE_TIERS) {
    if (requestedTotal <= tier) return tier
  }
  return META_ADS_SCRAPE_TIERS[META_ADS_SCRAPE_TIERS.length - 1]
}

export interface MetaAdsScrapeCreditInput {
  count: number
  /** Number of input URLs in pages mode; 1 for a keyword search. */
  sources: number
}

export function buildMetaAdsScrapeCreditId(input: MetaAdsScrapeCreditInput): string {
  const sources = Math.min(Math.max(Math.trunc(input.sources) || 1, 1), META_ADS_SCRAPE_MAX_SOURCES)
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), META_ADS_SCRAPE_MAX_COUNT)
  return `${META_ADS_SCRAPE_NODE_TYPE}:${metaAdsScrapeTier(count * sources)}`
}

/**
 * Resolve the credit identifier from an UNVALIDATED request body (the
 * creditGuard preHandler runs before Zod). It must land on the SAME tier the
 * post-Zod reservation computes, so an OMITTED count is the route's default
 * (Zod fills it in the same way); only a present-but-invalid body reserves
 * the fixed mid tier, and the route then rejects it with a 400 and refunds.
 */
export function resolveMetaAdsScrapeCreditId(body: unknown): string {
  const raw = body as { mode?: unknown; count?: unknown; pageUrls?: unknown } | null | undefined
  if (!raw || typeof raw !== "object") return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  const count = raw.count === undefined ? META_ADS_SCRAPE_DEFAULT_COUNT : raw.count
  if (!isMetaAdsScrapeCount(count)) return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  const sources = raw.mode === "pages"
    ? (Array.isArray(raw.pageUrls) ? raw.pageUrls.length : 0)
    : 1
  if (sources < 1 || sources > META_ADS_SCRAPE_MAX_SOURCES) return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  return buildMetaAdsScrapeCreditId({ count, sources })
}
