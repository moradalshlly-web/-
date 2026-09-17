import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { insertJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
// Core-safe commit/refund (keyed by job id, `ee/` reached via dynamic import) —
// keeps this route out of the core→ee allowlist that web-scrape still sits on.
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
// The two job-status funnels (CAS-guarded against a mid-flight cancel) instead
// of a direct jobs UPDATE — no service-role client in this file, and the
// completion/failure invariants stay in one place.
import { markJobCompleted } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { runMetaAdsScrape, type MetaAd } from "../providers/apify/meta-ads.js"
import { classifyAndStoreMetaAdsMedia, metaAdsWithoutMedia } from "../lib/meta-ads-media.js"
import {
  META_ADS_FORMATS,
  META_ADS_PLATFORMS,
  clampMetaAdsFeaturedIndex,
  featuredMetaAdOutputs,
  META_ADS_SCRAPE_DEFAULT_COUNT,
  META_ADS_SCRAPE_DEFAULT_COUNTRY,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_QUERY_LENGTH,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_NODE_TYPE,
  META_ADS_SCRAPE_PERIODS,
  META_ADS_SCRAPE_STATUSES,
  buildMetaAdsScrapeCreditId,
  resolveMetaAdsScrapeCreditId,
} from "@nodaro/shared"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { normalizeWebUrlInput } from "../lib/web-url-input.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { callCloudRoute } from "../providers/nodaro/client.js"

const ROUTE_PATH = "/v1/meta-ads-scrape"

/**
 * No Apify token of its own + a live nodaro.ai connection: the connection
 * runs the scrape (billed to the connected account) and this route relays
 * the result — the same shape the local provider returns, minus the cloud
 * job id (this install has its own job row). Mirrors web-scrape.
 */
async function scrapeViaConnection(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { jobId: _cloudJobId, ...result } = await callCloudRoute(ROUTE_PATH, body)
  return result
}

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "business.facebook.com"])

/** A Facebook PAGE address — scheme inferred like every other url field, then pinned to facebook.com so the actor is never handed an arbitrary site. */
const facebookPageUrl = z.preprocess(
  normalizeWebUrlInput,
  z.string().url().max(2048).refine((value) => {
    try {
      return FACEBOOK_HOSTS.has(new URL(value).hostname.toLowerCase())
    } catch {
      return false
    }
  }, { message: "Expected a Facebook Page URL (https://www.facebook.com/page-name)" }),
)

const countryCode = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.string().regex(/^(ALL|[A-Z]{2})$/, "Expected a 2-letter country code or ALL").default(META_ADS_SCRAPE_DEFAULT_COUNTRY),
)

const commonFields = {
  count: z.number().int().min(1).max(META_ADS_SCRAPE_MAX_COUNT).default(META_ADS_SCRAPE_DEFAULT_COUNT),
  period: z.enum(META_ADS_SCRAPE_PERIODS).default("30d"),
  activeStatus: z.enum(META_ADS_SCRAPE_STATUSES).default("active"),
  countryCode,
  /** Empty / every platform = no filter (the provider treats both the same). */
  platforms: z.array(z.enum(META_ADS_PLATFORMS)).max(META_ADS_PLATFORMS.length).optional(),
  /** Keep only ads whose primary creative has one of these formats (classified from its pixels); empty = all. May return fewer than `count`. */
  formats: z.array(z.enum(META_ADS_FORMATS)).max(META_ADS_FORMATS.length).optional(),
  /** Which returned ad feeds the typed text / image / video outputs (clamped). */
  featuredIndex: z.number().int().min(0).optional(),
  /** Copy the featured ad's video into the library too (only when its video output is wired — the expensive bytes). */
  ingestVideo: z.boolean().optional(),
}

/** The request owns 600 s; the actor may take 480 of them. Media work never starts past this point. */
const MEDIA_DEADLINE_MS = 570_000

const searchBody = z.object({
  mode: z.literal("search"),
  query: z.string().trim().min(1).max(META_ADS_SCRAPE_MAX_QUERY_LENGTH),
  ...commonFields,
})

const pagesBody = z.object({
  mode: z.literal("pages"),
  pageUrls: z.array(facebookPageUrl).min(1).max(META_ADS_SCRAPE_MAX_SOURCES),
  ...commonFields,
})

export const metaAdsScrapeBody = z.discriminatedUnion("mode", [searchBody, pagesBody])
export type MetaAdsScrapeBody = z.infer<typeof metaAdsScrapeBody>

export async function metaAdsScrapeRoutes(app: FastifyInstance) {
  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/meta-ads-scrape", {
    // Guard reads the RAW body (pre-Zod) and only CHECKS affordability — a
    // malformed body is checked at the fixed mid tier and the 400 below fires
    // before any reservation is made.
    preHandler: creditGuard((req) => resolveMetaAdsScrapeCreditId(req.body)),
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    req.raw.setTimeout(600_000)
    reply.raw.setTimeout(600_000)
    const startedAt = Date.now()

    const parsed = metaAdsScrapeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const body = parsed.data
    const sources = body.mode === "pages" ? body.pageUrls.length : 1
    const modelIdentifier = buildMetaAdsScrapeCreditId({ count: body.count, sources })

    const { data: job, error: jobError } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(body, META_ADS_SCRAPE_NODE_TYPE),
    })

    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    try {
      const viaCloud = await shouldRunOnCloud(config.APIFY_API_TOKEN)
      const scraped = viaCloud
        ? await scrapeViaConnection(body as Record<string, unknown>)
        : await runMetaAdsScrape(body)

      // Classify every creative's format, apply the format filter, and copy
      // the kept creatives into the user's library (durable urls) — under
      // the request deadline, never failing the paid scrape. A cloud relay
      // already stored them on the connected account, so only classify.
      const scrapedAds = (Array.isArray(scraped.json) ? scraped.json : []) as MetaAd[]
      const featuredIndex = clampMetaAdsFeaturedIndex(body.featuredIndex, scrapedAds.length)
      const media = await classifyAndStoreMetaAdsMedia(scrapedAds, {
        userId,
        jobId: job.id,
        deadlineAt: startedAt + MEDIA_DEADLINE_MS,
        storeImages: !viaCloud,
        storeVideoForAdIndex: body.ingestVideo && !viaCloud ? featuredIndex : undefined,
        formats: body.formats,
      }).catch((err: unknown) => {
        // The media step degrades internally; this is the belt to its braces —
        // a scrape the user already paid for never fails because the library
        // copy did. Source urls go out instead (they expire; the UI says so).
        req.log.warn({ err, jobId: job.id }, "[meta-ads-scrape] media step failed; returning the ads with their source urls")
        return { ads: metaAdsWithoutMedia(scrapedAds), stats: { classified: 0, stored: 0, kept: scrapedAds.length, filteredOut: 0 } }
      })
      const result = {
        json: media.ads,
        mediaStorage: media.stats,
        // The featured ad's typed outputs ride on output_data so the
        // orchestrator's NodeOutput carries them (see output-extractor).
        ...featuredMetaAdOutputs(media.ads, featuredIndex),
      }

      // false = the user cancelled mid-flight and the cancel path already
      // refunded — returning the data would be a free scrape.
      const completed = await markJobCompleted(job.id, { output_data: result })
      if (!completed) {
        return reply.status(409).send({ error: { code: "job_cancelled", message: "The job was cancelled before it completed." } })
      }

      if (usageLogId) await commitReservedCreditsForJob(job.id)

      return reply.send({ jobId: job.id, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scrape failed"
      // Refund only when WE flipped the row — a cancelled job was refunded by cancel.
      const flipped = await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })
      if (flipped && usageLogId) await refundReservedCreditsForJob(job.id)
      return reply.status(502).send({ error: { code: "scrape_error", message } })
    }
  })
}
