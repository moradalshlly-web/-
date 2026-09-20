import { isCloud } from "./config.js"
import { getAppVersion } from "./app-version.js"

/**
 * "Is a newer release out?" — the backend half of the sidebar's red dot
 * (versioning spec, 2026-08-19).
 *
 * Reads the PUBLIC mirror's releases and picks the newest `vX.Y.Z` tag.
 * NEVER `releases/latest`: the repo also hosts the npm package releases
 * (@nodaro/sdk@…, @nodaro/prompts@… — they were "latest" the day this was
 * written), so the latest RELEASE is usually not an app release at all.
 *
 * Privacy: HTTPS requests to api.github.com — once a read has succeeded, one
 * per CACHE_TTL_MS per process. Nothing about the install rides along. Opt out
 * with NODARO_UPDATE_CHECK=off. On cloud `latest` still flows (it feeds the
 * "what's new" dialog) but updateAvailable is always false — we ARE the
 * newest version there by definition.
 *
 * A FAILED READ IS NOT AN ANSWER, and is not cached like one. It used to be:
 * one refused request pinned `latest: null` and the package.json version for
 * 24 hours. GitHub allows an anonymous caller 60 requests an hour PER ADDRESS,
 * and a hosted deployment shares its outbound address with strangers, so a
 * refusal is ordinary there — and every deploy is a new process with a first
 * read to lose (production: `{"current":"1.23.0","latest":null}` on a fresh
 * deploy, while staging, same code, answered correctly). Now a read that did
 * not settle keeps the last good answer, is made again after FIRST_RETRY_MS
 * (tripling up to the full TTL) and says why in the log.
 * NODARO_UPDATE_CHECK_TOKEN — any GitHub token, it needs no scopes — takes the
 * reads off the shared address's quota altogether.
 */

const RELEASES_URL = "https://api.github.com/repos/nodaroai/app.nodaro.ai/releases?per_page=20"
const TAGS_URL = "https://api.github.com/repos/nodaroai/app.nodaro.ai/tags?per_page=100"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FIRST_RETRY_MS = 5 * 60 * 1000
const HIGHLIGHT_MAX_CHARS = 1200
const APP_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

export interface LatestRelease {
  readonly version: string
  readonly url: string
  readonly publishedAt: string
  readonly highlights: string
}

export interface UpdateStatus {
  readonly current: string
  readonly latest: LatestRelease | null
  readonly updateAvailable: boolean
}

// ---------------------------------------------------------------------------
// A read that knows the difference between an answer and a failure
// ---------------------------------------------------------------------------

type ReadOutcome<T> =
  /** Will never change for this process — asked once, kept for good. */
  | { readonly kind: "final"; readonly value: T }
  /** A real answer — kept for CACHE_TTL_MS. */
  | { readonly kind: "fresh"; readonly value: T }
  /** The read worked, the answer is not there YET. Normal, so not logged. */
  | { readonly kind: "not-yet" }
  /** Refused, timed out or unreadable. */
  | { readonly kind: "failed"; readonly why: string }

interface ReadState<T> {
  /** The last GOOD value — a read that does not settle never replaces it. */
  readonly value: T
  readonly nextReadAt: number
  /** Consecutive reads that did not settle; spaces the next one out. */
  readonly unsettled: number
}

/** 5 min, 15 min, 45 min, 2¼ h, 6¾ h, 20¼ h, then the full TTL. Tight enough to
 *  heal a blip within minutes, loose enough never to spend a shared quota on a
 *  refusal that persists. */
export function retryAfterMs(unsettled: number): number {
  return Math.min(CACHE_TTL_MS, FIRST_RETRY_MS * 3 ** Math.max(0, unsettled - 1))
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timed out" : err.message
  return String(err)
}

function createCachedRead<T>(label: string, initial: T, read: () => Promise<ReadOutcome<T>>) {
  const blank: ReadState<T> = { value: initial, nextReadAt: 0, unsettled: 0 }
  let state = blank
  let inflight: Promise<void> | null = null

  function settle(outcome: ReadOutcome<T>): ReadState<T> {
    const now = Date.now()
    if (outcome.kind === "final") return { value: outcome.value, nextReadAt: Number.POSITIVE_INFINITY, unsettled: 0 }
    if (outcome.kind === "fresh") return { value: outcome.value, nextReadAt: now + CACHE_TTL_MS, unsettled: 0 }
    const unsettled = state.unsettled + 1
    const wait = retryAfterMs(unsettled)
    if (outcome.kind === "failed") {
      // The one line that tells "refused from this address" apart from every
      // other guess, next time this is looked into. At most a handful a day.
      console.warn(`[update-check] ${label} read failed: ${outcome.why} — next try in ${Math.round(wait / 60_000)} min`)
    }
    return { value: state.value, nextReadAt: now + wait, unsettled }
  }

  return {
    async get(): Promise<T> {
      if (Date.now() >= state.nextReadAt) {
        if (!inflight) {
          inflight = read()
            .catch((err: unknown): ReadOutcome<T> => ({ kind: "failed", why: describeError(err) }))
            .then((outcome) => {
              state = settle(outcome)
              inflight = null
            })
        }
        await inflight
      }
      return state.value
    },
    reset(): void {
      state = blank
      inflight = null
    },
  }
}

/** Why a GitHub answer was not OK — with the quota headers, which are the whole
 *  story when the caller shares its address. Never the body, never the token. */
function describeRefusal(res: Response): string {
  const remaining = res.headers?.get?.("x-ratelimit-remaining")
  const limit = res.headers?.get?.("x-ratelimit-limit")
  const reset = Number(res.headers?.get?.("x-ratelimit-reset"))
  if (remaining === null || remaining === undefined) return `HTTP ${res.status}`
  const resets = Number.isFinite(reset) && reset > 0 ? `, resets ${new Date(reset * 1000).toISOString()}` : ""
  return `HTTP ${res.status} (rate limit: ${remaining} of ${limit ?? "?"} left${resets})`
}

function githubHeaders(): Record<string, string> {
  const token = process.env.NODARO_UPDATE_CHECK_TOKEN?.trim()
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function githubGet(url: string): Promise<Response> {
  return fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(8_000) })
}

// ---------------------------------------------------------------------------
// The running version, from the deployed commit
// ---------------------------------------------------------------------------

/**
 * Cloud runs whatever commit Railway deployed, and Railway injects that SHA
 * (RAILWAY_GIT_COMMIT_SHA) but no version — so the label showed the stale
 * package.json fallback ("v1.23.0" beside "What's new in v1.27.0", founder
 * report 2026-08-19). Every production commit on main carries its release
 * tag, so a tags-API read maps the running SHA to its exact version.
 *
 * A hit is FINAL: the commit a process runs never changes, so it is never
 * asked again. No match is "not yet", not "no": the release tag is pushed by a
 * workflow that runs AFTER the merge that triggered the deploy, so a process can
 * easily boot before its own tag exists. (Staging runs untagged dev commits and
 * simply keeps the fallback; its retries thin out to one a day.)
 */
async function readDeployedVersion(): Promise<ReadOutcome<string | null>> {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
  if (!sha) return { kind: "final", value: null }
  const res = await githubGet(TAGS_URL)
  if (!res.ok) return { kind: "failed", why: describeRefusal(res) }
  const tags = (await res.json()) as Array<{ name?: string; commit?: { sha?: string } }>
  if (!Array.isArray(tags)) return { kind: "failed", why: "unexpected body" }
  const hit = tags.find((t) => t.commit?.sha === sha && t.name && APP_TAG.test(t.name))
  return hit?.name ? { kind: "final", value: hit.name } : { kind: "not-yet" }
}

const deployedVersion = createCachedRead<string | null>("deployed version", null, readDeployedVersion)

export function updateCheckEnabled(): boolean {
  return (process.env.NODARO_UPDATE_CHECK ?? "").trim().toLowerCase() !== "off"
}

function parseSemver(v: string): [number, number, number] | null {
  const m = APP_TAG.exec(v.startsWith("v") ? v : `v${v}`)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when b is strictly newer than a. Unparseable sides compare as not-newer
 *  (a `1.23.0-dev.abc` local build never nags about itself). */
export function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a.split("-")[0])
  const pb = parseSemver(b.split("-")[0])
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i++) {
    if (pb[i] !== pa[i]) return pb[i] > pa[i]
  }
  return false
}

function trimHighlights(body: string | null | undefined): string {
  const text = (body ?? "").trim()
  if (text.length <= HIGHLIGHT_MAX_CHARS) return text
  const cut = text.slice(0, HIGHLIGHT_MAX_CHARS)
  const lastLine = cut.lastIndexOf("\n")
  return (lastLine > 0 ? cut.slice(0, lastLine) : cut) + "\n…"
}

// ---------------------------------------------------------------------------
// The newest app release
// ---------------------------------------------------------------------------

async function readLatestAppRelease(): Promise<ReadOutcome<LatestRelease | null>> {
  const res = await githubGet(RELEASES_URL)
  if (!res.ok) return { kind: "failed", why: describeRefusal(res) }
  const releases = (await res.json()) as Array<{
    tag_name?: string
    html_url?: string
    published_at?: string
    body?: string | null
    draft?: boolean
    prerelease?: boolean
  }>
  if (!Array.isArray(releases)) return { kind: "failed", why: "unexpected body" }
  let best: LatestRelease | null = null
  for (const r of releases) {
    if (r.draft || r.prerelease) continue
    if (!r.tag_name || !APP_TAG.test(r.tag_name)) continue
    if (best === null || isNewer(best.version, r.tag_name)) {
      best = {
        version: r.tag_name,
        url: r.html_url ?? "https://github.com/nodaroai/app.nodaro.ai/releases",
        publishedAt: r.published_at ?? "",
        highlights: trimHighlights(r.body),
      }
    }
  }
  // A page with no app release on it is still an ANSWER ("none"), not a failure.
  return { kind: "fresh", value: best }
}

const latestRelease = createCachedRead<LatestRelease | null>("latest release", null, readLatestAppRelease)

/**
 * The full status for `GET /v1/version`. Errors degrade to "no update known"
 * — a GitHub hiccup must never surface as anything at all.
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const fallback = getAppVersion()
  if (!updateCheckEnabled()) {
    return { current: fallback, latest: null, updateAvailable: false }
  }
  // Image-baked env wins; otherwise try the deployed-SHA -> tag match
  // before settling for the package.json fallback.
  const [fromSha, latest] = await Promise.all([
    process.env.APP_VERSION?.trim() ? Promise.resolve(null) : deployedVersion.get(),
    latestRelease.get(),
  ])
  const current = fromSha ? fromSha.replace(/^v/, "") : fallback
  return {
    current,
    latest,
    // Cloud always RUNS the newest deploy, so there is never an update to
    // offer — but `latest` still flows: the founder-requested "what's new"
    // dialog shows cloud users the changelog of what just shipped
    // (2026-08-19). Self-host keeps the red-dot semantics.
    updateAvailable: !isCloud() && latest !== null && isNewer(current, latest.version),
  }
}

export function _resetUpdateCheckForTests(): void {
  deployedVersion.reset()
  latestRelease.reset()
}
