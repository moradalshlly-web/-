import type { MetaAdsScrapeNodeData } from "@/types/nodes"
import {
  applyWebScrapeFailure,
  applyWebScrapeResult,
  webScrapeResultCount,
  type WebScrapeCardState,
  type WebScrapeOutcome,
} from "./web-scrape-run-state"

/**
 * Meta Ads run-state logic — the same five-state contract as Web Scrape
 * (#765): a FAILED or EMPTY run never replaces the last good payload, and
 * changing the inputs marks the result STALE instead of deleting it. The
 * outcome/failure patches are shared verbatim (they only read the json /
 * message); only the fingerprint and the item shape are Meta-specific.
 *
 * Everything below the run-state block is the pure presentation vocabulary
 * the card and the Results tab share (initial, headline, media label, date
 * range …) so the two surfaces can never describe the same ad differently.
 */

export type MetaAdsScrapeCardState = WebScrapeCardState

/** The normalized ad rows (backend `MetaAd`) the peek + Results list render. */
export function metaAdsScrapeItems(json: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!Array.isArray(json)) return []
  return json.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []
}

/** Only http(s) ever becomes an anchor / img src — scraped urls are untrusted (#779). */
function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? raw.trim() : null
  } catch {
    return null
  }
}

/** "Page — first words of the copy" — one truncated line per ad. `noCopy` is the localized fallback for an ad with no text. */
export function metaAdPeekLine(item: Record<string, unknown>, noCopy = "(no copy)"): string {
  const page = str(item.pageName)
  const copy = str(item.text) || str(item.title) || noCopy
  return page ? `${page} — ${copy}` : copy
}

/** ▶ when the creative is a video, ▣ otherwise. */
export function metaAdGlyph(item: Record<string, unknown>): string {
  return strings(item.videos).length > 0 ? "▶" : "▣"
}

/** The ad's own Ad Library page. */
export function metaAdLink(item: Record<string, unknown>): string | null {
  return httpUrl(item.adLibraryUrl)
}

/** Human names for Meta's `publisher_platform` codes. Brand names — not localized. */
export const META_ADS_PLATFORM_LABELS: Readonly<Record<string, string>> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  AUDIENCE_NETWORK: "Audience Network",
  MESSENGER: "Messenger",
  WHATSAPP: "WhatsApp",
  THREADS: "Threads",
}

export function metaAdPlatformLabel(code: string): string {
  return META_ADS_PLATFORM_LABELS[code] ?? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ")
}

export function metaAdPlatforms(item: Record<string, unknown>): string[] {
  return strings(item.platforms)
}

/** "Facebook +3" — the first platform plus a count, for one-line rows. */
export function metaAdPlatformsShort(item: Record<string, unknown>): string {
  const codes = metaAdPlatforms(item)
  if (codes.length === 0) return ""
  const first = metaAdPlatformLabel(codes[0])
  return codes.length > 1 ? `${first} +${codes.length - 1}` : first
}

export function metaAdMediaCounts(item: Record<string, unknown>): { readonly images: number; readonly videos: number } {
  return { images: strings(item.images).length, videos: strings(item.videos).length }
}

/** `title`, falling back to the first line of the body copy. */
export function metaAdHeadline(item: Record<string, unknown>): string {
  return str(item.title) || str(item.text).split("\n")[0]?.trim() || ""
}

/** The advertiser's initial for the striped placeholder + avatar tile. */
export function metaAdInitial(item: Record<string, unknown>): string {
  const name = str(item.pageName)
  const first = [...name][0]
  return first ? first.toUpperCase() : "?"
}

/** `videoPreviews[0] ?? images[0]` — the poster the card shows before (or instead of) the media. */
export function metaAdPreviewUrl(item: Record<string, unknown>): string | null {
  const candidates = [...strings(item.videoPreviews), ...strings(item.images)]
  for (const c of candidates) {
    const u = httpUrl(c)
    if (u) return u
  }
  return null
}

/** The first playable creative (`videos[0]`), http(s) only. */
export function metaAdVideoUrl(item: Record<string, unknown>): string | null {
  for (const v of strings(item.videos)) {
    const u = httpUrl(v)
    if (u) return u
  }
  return null
}

/** The destination domain: `caption`, else the hostname of `linkUrl`. */
export function metaAdDomain(item: Record<string, unknown>): string {
  const caption = str(item.caption)
  if (caption) return caption
  const link = httpUrl(item.linkUrl)
  if (!link) return ""
  try {
    return new URL(link).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export function metaAdLinkUrl(item: Record<string, unknown>): string | null {
  return httpUrl(item.linkUrl)
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t) : null
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

/** "Aug 27 → Sep 17"; an open-ended ad renders "Aug 27 →". */
export function metaAdDateRange(item: Record<string, unknown>): string {
  const start = parseDate(item.startDate)
  const end = parseDate(item.endDate)
  if (!start) return ""
  return end ? `${SHORT_DATE.format(start)} → ${SHORT_DATE.format(end)}` : `${SHORT_DATE.format(start)} →`
}

export function metaAdStartLabel(item: Record<string, unknown>): string {
  const start = parseDate(item.startDate)
  return start ? SHORT_DATE.format(start) : ""
}

/** Whole days the ad has been running (start → end, or → now while it runs). */
export function metaAdRunDays(item: Record<string, unknown>, now: number = Date.now()): number | null {
  const start = parseDate(item.startDate)
  if (!start) return null
  const end = parseDate(item.endDate)?.getTime() ?? now
  return Math.max(0, Math.round((end - start.getTime()) / 86_400_000))
}

export function metaAdsActiveCount(items: ReadonlyArray<Record<string, unknown>>): number {
  return items.filter((a) => a.isActive === true).length
}

/** The featured ad index, clamped so a rerun that returned fewer ads never indexes past the end. */
export function clampFeaturedIndex(stored: unknown, count: number): number {
  if (count <= 0) return 0
  const n = typeof stored === "number" && Number.isFinite(stored) ? Math.trunc(stored) : 0
  return Math.min(Math.max(n, 0), count - 1)
}

/** Fingerprint of every field that changes what a run would fetch. */
export function metaAdsScrapeFingerprint(d: MetaAdsScrapeNodeData): string {
  return JSON.stringify([
    d.mode ?? "search",
    d.query ?? "",
    d.pageUrls ?? "",
    d.count ?? null,
    d.period ?? "",
    d.activeStatus ?? "",
    d.countryCode ?? "",
    Array.isArray(d.platforms) ? [...d.platforms].sort() : [],
  ])
}

export function metaAdsScrapeRunStartPatch(d: MetaAdsScrapeNodeData): Record<string, unknown> {
  return {
    executionStatus: "running",
    errorMessage: undefined,
    lastRunStartedAt: Date.now(),
    lastRunFingerprint: metaAdsScrapeFingerprint(d),
  }
}

/** A fresh payload starts at the first ad (the previous featured index may not exist any more). */
export function applyMetaAdsScrapeResult(json: unknown): Record<string, unknown> {
  const patch = applyWebScrapeResult(json)
  return patch.lastRunOutcome === "success" ? { ...patch, featuredIndex: 0 } : patch
}
export const applyMetaAdsScrapeFailure = applyWebScrapeFailure

export function deriveMetaAdsScrapeCardState(d: MetaAdsScrapeNodeData): MetaAdsScrapeCardState {
  if (d.executionStatus === "running") {
    return { kind: "running", startedAt: d.lastRunStartedAt as number | undefined }
  }
  const outcome = d.lastRunOutcome as WebScrapeOutcome | undefined
  if (!outcome) {
    if (d.generatedJson !== undefined) {
      const count = webScrapeResultCount(d.generatedJson)
      return { kind: count > 0 ? "success" : "empty", count, stale: false }
    }
    return { kind: "never-ran" }
  }
  const stale =
    typeof d.lastRunFingerprint === "string" && d.lastRunFingerprint !== metaAdsScrapeFingerprint(d)
  if (outcome === "failed") {
    const keptCount = (d.lastGoodCount as number | undefined) ?? webScrapeResultCount(d.generatedJson)
    return {
      kind: "failed",
      count: 0,
      at: d.lastRunAt as number | undefined,
      stale,
      errorMessage: d.errorMessage,
      ...(keptCount > 0 ? { kept: { count: keptCount, at: d.lastGoodAt as number | undefined } } : {}),
    }
  }
  return {
    kind: outcome,
    count: (d.lastRunCount as number | undefined) ?? webScrapeResultCount(d.generatedJson),
    at: d.lastRunAt as number | undefined,
    stale,
  }
}
