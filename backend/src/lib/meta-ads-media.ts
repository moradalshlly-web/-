import sharp from "sharp"
import { classifyCreativeFormat, type MetaAdsCreativeFormat, type MetaAdsFormat } from "@nodaro/shared"
import { safeFetch } from "./safe-fetch.js"
import { deadlinePool } from "./deadline-pool.js"
import { readBodyCapped, storeImportedImageBuffer } from "./media-import.js"
import { isStorageConfigured, isStorageLimitError, uploadToR2 } from "./storage.js"
import { supabase } from "./supabase.js"
import type { MetaAd } from "../providers/apify/meta-ads.js"

/**
 * Meta Ads creatives: classify every ad's format from its measured pixels
 * and, when the install has storage, copy the creatives into the user's
 * library so the node's outputs outlive Meta's signed CDN urls (they expire
 * in days).
 *
 * Contract, in order of importance:
 *   1. NEVER fail a scrape the user already paid for. Every step here degrades
 *      to "keep the external url" — a failed fetch, an undecodable image, a
 *      full quota, a missing R2 config, or simply running out of time.
 *   2. Stay inside the route's 600 s request. The actor already owns most of
 *      it, so everything below runs under a deadline with per-item timeouts.
 *   3. One classifier (`classifyCreativeFormat`, packages/shared) for the
 *      node setting, the Results chips and the card.
 *
 * Library policy: rows are quota-accounted assets (`upload_source:
 * url_import`, `source: meta-ads`, `job_id` set) with `in_library: false` —
 * a daily schedule must not flood the media picker with competitor ads. The
 * Results tab's explicit "save" flips `in_library` on.
 */

export interface MetaAdCreative {
  readonly kind: "image" | "video"
  /** The url downstream consumers get — ours once stored, else the source. */
  readonly url: string
  readonly sourceUrl: string
  /** Video only: poster frame (ours once stored). */
  readonly posterUrl: string | null
  readonly width: number | null
  readonly height: number | null
  readonly format: MetaAdsCreativeFormat
  /** The library row for `url` once stored; for a video whose POSTER alone was copied, the poster's row (and `stored` stays false). */
  readonly assetId: string | null
  /** True when `url` itself points at the user's library. */
  readonly stored: boolean
}

export interface MetaAdWithMedia extends MetaAd {
  /** The primary creative's format — first video (via its poster), else first image. */
  readonly format: MetaAdsCreativeFormat
  readonly creatives: MetaAdCreative[]
}

export type MetaAdsMediaSkipReason = "not_configured" | "storage_limit_exceeded" | "deadline"

export interface MetaAdsMediaStats {
  readonly classified: number
  readonly stored: number
  /** Of `stored`, how many were VIDEO bytes (the expensive ones) — the rest are images + posters. */
  readonly videosStored: number
  readonly kept: number
  readonly filteredOut: number
  readonly skipReason?: MetaAdsMediaSkipReason
}

export interface MetaAdsMediaOptions {
  readonly userId: string
  readonly jobId: string
  /** Epoch ms after which no new fetch/upload starts (existing ones finish). */
  readonly deadlineAt: number
  /** Copy creatives into the user's library (false on a cloud relay: the cloud already stored them). */
  readonly storeImages: boolean
  /** Copy the featured ad's video too (its index into the KEPT list) — only when its video output is wired. */
  readonly storeFeaturedVideoIndex?: number
  /** Copy EVERY kept ad's first video (the expensive bytes) — the "copy all videos" node setting. */
  readonly storeAllVideos?: boolean
  /** Keep only ads of these formats; empty / undefined = keep all. */
  readonly formats?: readonly MetaAdsFormat[]
  readonly concurrency?: number
  readonly now?: () => number
}

/** Images are fetched for classification anyway; keep the cap well under the import route's 20 MB. */
const CREATIVE_MAX_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000
const DEFAULT_CONCURRENCY = 6

type Probe = { readonly buffer: Buffer; readonly width: number | null; readonly height: number | null }

async function fetchAndProbe(url: string): Promise<Probe | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS })
    if (!res.ok) return null
    const buffer = await readBodyCapped(res, CREATIVE_MAX_BYTES)
    if (!buffer) return null
    try {
      const meta = await sharp(buffer).metadata()
      return { buffer, width: meta.width ?? null, height: meta.height ?? null }
    } catch {
      return { buffer, width: null, height: null }
    }
  } catch {
    return null
  }
}

interface Slot {
  readonly adIndex: number
  readonly creativeIndex: number
  /** The url whose pixels decide the format (the poster for a video). */
  readonly probeUrl: string
}

function initialCreatives(ad: MetaAd): MetaAdCreative[] {
  const videos = ad.videos.map((url, i) => ({
    kind: "video" as const,
    url,
    sourceUrl: url,
    posterUrl: ad.videoPreviews[i] ?? null,
    width: null,
    height: null,
    format: "unknown" as const,
    assetId: null,
    stored: false,
  }))
  const images = ad.images.map((url) => ({
    kind: "image" as const,
    url,
    sourceUrl: url,
    posterUrl: null,
    width: null,
    height: null,
    format: "unknown" as const,
    assetId: null,
    stored: false,
  }))
  return [...videos, ...images]
}

function primaryFormat(creatives: readonly MetaAdCreative[]): MetaAdsCreativeFormat {
  return creatives[0]?.format ?? "unknown"
}

/** The route's last resort when the media step itself throws: the ads as scraped, formats unknown, nothing stored. */
export function metaAdsWithoutMedia(ads: readonly MetaAd[]): MetaAdWithMedia[] {
  return ads.map((ad) => ({ ...ad, format: "unknown" as const, creatives: initialCreatives(ad) }))
}

/**
 * Classify → filter → store. Returns the ads (possibly fewer, when a format
 * filter is set) with `format` + `creatives` and durable urls swapped in
 * place, plus honest stats for the caller / the UI.
 */
export async function classifyAndStoreMetaAdsMedia(
  ads: readonly MetaAd[],
  opts: MetaAdsMediaOptions,
): Promise<{ ads: MetaAdWithMedia[]; stats: MetaAdsMediaStats }> {
  const now = opts.now ?? Date.now
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  const creativesByAd: MetaAdCreative[][] = ads.map(initialCreatives)
  const probes = new Map<string, Probe | null>()

  // ── 1. Classify: one fetch per creative (poster for a video), bounded, deadlined ──
  const slots: Slot[] = []
  for (const [adIndex, creatives] of creativesByAd.entries()) {
    for (const [creativeIndex, c] of creatives.entries()) {
      const probeUrl = c.kind === "video" ? c.posterUrl : c.url
      if (probeUrl) slots.push({ adIndex, creativeIndex, probeUrl })
    }
  }
  const classifyHitDeadline = await deadlinePool(slots, concurrency, opts.deadlineAt, now, async (slot) => {
    if (!probes.has(slot.probeUrl)) probes.set(slot.probeUrl, await fetchAndProbe(slot.probeUrl))
    const probe = probes.get(slot.probeUrl)
    const c = creativesByAd[slot.adIndex][slot.creativeIndex]
    creativesByAd[slot.adIndex][slot.creativeIndex] = {
      ...c,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      format: classifyCreativeFormat(probe?.width, probe?.height),
    }
  })
  const classified = slots.filter((s) => probes.get(s.probeUrl)?.width).length

  // ── 2. Filter by format (node setting) ──
  const wanted = new Set<string>(opts.formats ?? [])
  const keptIndexes = ads
    .map((_, i) => i)
    .filter((i) => wanted.size === 0 || wanted.has(primaryFormat(creativesByAd[i])))

  // ── 3. Store creatives of the KEPT ads (images + posters; asked-for videos) ──
  let stored = 0
  let videosStored = 0
  let skipReason: MetaAdsMediaSkipReason | undefined = classifyHitDeadline ? "deadline" : undefined
  const canStore = opts.storeImages && isStorageConfigured()
  if (opts.storeImages && !isStorageConfigured()) skipReason = "not_configured"

  if (canStore) {
    let quotaExceeded = false
    const targets = keptIndexes.flatMap((adIndex) =>
      creativesByAd[adIndex].map((_, creativeIndex) => ({ adIndex, creativeIndex })),
    )
    const storeHitDeadline = await deadlinePool(targets, Math.min(concurrency, 4), opts.deadlineAt, now, async ({ adIndex, creativeIndex }) => {
      if (quotaExceeded) return
      const c = creativesByAd[adIndex][creativeIndex]
      const probeUrl = c.kind === "video" ? c.posterUrl : c.url
      const probe = probeUrl ? probes.get(probeUrl) : undefined
      if (!probe) return
      const ad = ads[adIndex]
      const result = await storeImportedImageBuffer({
        userId: opts.userId,
        body: probe.buffer,
        uploadSource: "url_import",
        sourceUrl: probeUrl!,
        filename: `meta-ad-${ad.adArchiveId}-${creativeIndex}${c.kind === "video" ? "-poster" : ""}`,
        source: "meta-ads",
        sourceDetail: ad.pageName || undefined,
        inLibrary: false,
        jobId: opts.jobId,
      }).catch(() => null)
      if (!result) return
      if (!result.ok) {
        if (result.code === "storage_limit_exceeded") quotaExceeded = true
        return
      }
      stored += 1
      creativesByAd[adIndex][creativeIndex] = c.kind === "video"
        ? { ...c, posterUrl: result.url, assetId: result.assetId, stored: c.stored }
        : { ...c, url: result.url, assetId: result.assetId, stored: true }
    })
    if (quotaExceeded) skipReason = "storage_limit_exceeded"
    else if (storeHitDeadline) skipReason = "deadline"

    // The asked-for videos (featured when wired, and/or all when "copy all
    // videos" is on) — the first video creative per ad. Serial-ish (bounded
    // at 2: these are large downloads), deadline-aware, and a quota refusal
    // stops the rest rather than hammering N failed uploads. Deduped: the
    // featured ad is not copied twice when "copy all" is also on.
    const videoTargetSet = new Set<number>()
    if (opts.storeAllVideos) for (const adIndex of keptIndexes) videoTargetSet.add(adIndex)
    if (opts.storeFeaturedVideoIndex !== undefined) {
      const adIndex = keptIndexes[opts.storeFeaturedVideoIndex]
      if (adIndex !== undefined) videoTargetSet.add(adIndex)
    }
    const videoTargets = [...videoTargetSet]
    if (videoTargets.length > 0 && !quotaExceeded) {
      const videoHitDeadline = await deadlinePool(videoTargets, 2, opts.deadlineAt, now, async (adIndex) => {
        if (quotaExceeded) return
        const creativeIndex = creativesByAd[adIndex].findIndex((c) => c.kind === "video")
        if (creativeIndex < 0) return
        const c = creativesByAd[adIndex][creativeIndex]
        const ad = ads[adIndex]
        const storedVideo = await storeMetaAdVideo({
          userId: opts.userId,
          jobId: opts.jobId,
          adArchiveId: ad.adArchiveId,
          pageName: ad.pageName,
          sourceUrl: c.sourceUrl,
          posterUrl: c.posterUrl,
        })
        if (storedVideo.quota) {
          quotaExceeded = true
          return
        }
        if (storedVideo.ok) {
          stored += 1
          videosStored += 1
          creativesByAd[adIndex][creativeIndex] = { ...c, url: storedVideo.url, assetId: storedVideo.assetId, stored: true }
        }
      })
      if (quotaExceeded) skipReason = "storage_limit_exceeded"
      else if (videoHitDeadline && !skipReason) skipReason = "deadline"
    }
  }

  // ── 4. Assemble: durable urls swapped in place so every existing consumer keeps working ──
  const out: MetaAdWithMedia[] = keptIndexes.map((adIndex) => {
    const ad = ads[adIndex]
    const creatives = creativesByAd[adIndex]
    const videos = creatives.filter((c) => c.kind === "video")
    const images = creatives.filter((c) => c.kind === "image")
    return {
      ...ad,
      images: images.map((c) => c.url),
      videos: videos.map((c) => c.url),
      videoPreviews: videos.map((c) => c.posterUrl).filter((u): u is string => !!u),
      format: primaryFormat(creatives),
      creatives,
    }
  })

  return {
    ads: out,
    stats: {
      classified,
      stored,
      videosStored,
      kept: out.length,
      filteredOut: ads.length - out.length,
      ...(skipReason ? { skipReason } : {}),
    },
  }
}

type StoredVideo =
  | { readonly ok: true; readonly quota: false; readonly url: string; readonly assetId: string | null }
  | { readonly ok: false; readonly quota: boolean }

/** Stream one creative video into R2 (quota-reserved) and record the asset row. `quota:true` = the user's storage limit refused it (the caller stops copying more). */
async function storeMetaAdVideo(args: {
  userId: string
  jobId: string
  adArchiveId: string
  pageName: string
  sourceUrl: string
  posterUrl: string | null
}): Promise<StoredVideo> {
  // adArchiveId is external actor data → sanitize before it becomes an R2
  // object key / filename (copy-all-videos writes one per ad).
  const safeId = String(args.adArchiveId).replace(/[^a-zA-Z0-9_-]/g, "") || "ad"
  const outputId = `meta-ad-${safeId}-${args.jobId.slice(0, 8)}`
  try {
    const url = await uploadToR2(args.sourceUrl, outputId, "video", args.userId, { reserveQuota: true })
    // uploadToR2 reserved + settled the bytes already — no updateStorageUsage here.
    const { data, error } = await supabase
      .from("assets")
      .insert({
        user_id: args.userId,
        job_id: args.jobId,
        type: "video",
        filename: `${outputId}.mp4`,
        mime_type: "video/mp4",
        size_bytes: 0,
        r2_key: `videos/${outputId}.mp4`,
        r2_url: url,
        upload_source: "url_import",
        source: "meta-ads",
        source_detail: args.pageName || null,
        in_library: false,
        metadata: { thumbnail_url: args.posterUrl, source_url: args.sourceUrl },
      })
      .select("id")
      .single()
    if (error) console.warn(`[meta-ads-media] video asset row failed for ${outputId} (video kept, unowned): ${error.message}`)
    return { ok: true, quota: false, url, assetId: data?.id ?? null }
  } catch (err) {
    // Quota is a TYPED signal from storage.ts (isStorageLimitError), not a
    // grep on the thrown string — a reworded message can't silently turn a
    // quota refusal into a "retryable" that hammers every kept ad.
    const quota = isStorageLimitError(err)
    // Quota is expected (the user is full) — noise-free; anything else is logged.
    if (!quota) console.warn(`[meta-ads-media] video store failed for ${outputId}: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, quota }
  }
}
