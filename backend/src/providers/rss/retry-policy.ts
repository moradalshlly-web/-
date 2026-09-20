/**
 * When the RSS fetch asks an upstream again, and how long it waits first.
 * Pure — no timers, no I/O; `fetchRssItems` owns the loop and the one deadline.
 *
 * Why this exists: on 2026-09-20 youtube.com/feeds/videos.xml answered 404 and
 * 500 for every channel (YouTube's own included) from three independent
 * networks for 10+ minutes, minutes after answering 200. One request, one
 * answer, was the whole strategy.
 *
 * What it can and cannot do: a few attempts inside one request cannot bridge a
 * ten-minute outage — nothing held open under the ~100 s edge limit can. It
 * bridges the FLAPS: the dropped connection, the one bad backend behind a load
 * balancer, the minutes on either side of an incident when an upstream answers
 * some requests and not others. A run that still fails is refunded, so the cost
 * of trying is a second or two on a path that charges nothing.
 *
 * No host lists: every rule below is about the kind of failure, never about
 * who answered.
 */

/** Requests made in total, the first one included. */
export const MAX_ATTEMPTS = 3

/** First retry waits 400–800 ms, the second 800–1600 ms: 2.4 s at the very most. */
const BACKOFF_STEP_MS = 800

/**
 * The longest single wait worth holding a request open for. An upstream that
 * asks for more (`Retry-After: 120`) is telling us this run cannot succeed —
 * fail now and refund, rather than knock again before it asked us to.
 */
export const MAX_RETRY_WAIT_MS = 5_000

export type FetchFailure =
  | { readonly kind: "network" }
  | { readonly kind: "http"; readonly status: number }

/** 408 Request Timeout, 425 Too Early, 429 Too Many Requests — "not now" by definition. */
const TRANSIENT_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429])

/**
 * How many retries a failure of this kind may have had before it is final.
 *
 *  - network errors, 5xx and the "not now" statuses: the full schedule.
 *  - 404: ONE retry. A 404 is normally a verdict (a mistyped address), and then
 *    the retry costs one extra round trip on a run that is refunded anyway. But
 *    the 2026-09-20 evidence is that it is not ALWAYS a verdict: the same
 *    endpoint answered 404 and 500 interchangeably for addresses it had served
 *    minutes earlier, so its 404 said "this backend is unwell", not "no such
 *    feed". One retry catches that blip; a second and third would only slow the
 *    typo down — and that incident outlasted any schedule that fits in a request.
 *  - every other status (400, 401, 403, 410, …): a verdict. Asking again only
 *    repeats the question.
 */
export function retriesAllowedFor(failure: FetchFailure): number {
  if (failure.kind === "network") return MAX_ATTEMPTS - 1
  if (failure.status >= 500 || TRANSIENT_CLIENT_STATUSES.has(failure.status)) return MAX_ATTEMPTS - 1
  if (failure.status === 404) return 1
  return 0
}

/**
 * Exponential backoff with "equal" jitter: half the step is guaranteed (two
 * requests are never back to back), the other half is random (many runs that
 * failed together do not come back together).
 *
 * @param retryNumber 1 for the first retry, 2 for the second.
 */
export function backoffDelayMs(retryNumber: number, random: () => number = Math.random): number {
  const step = BACKOFF_STEP_MS * 2 ** (retryNumber - 1)
  return Math.round(step / 2 + random() * (step / 2))
}

/**
 * `Retry-After` as milliseconds from `nowMs`: delta-seconds or an HTTP date
 * (RFC 9110 §10.2.3). `undefined` when absent or unreadable — never a guess.
 */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | undefined {
  const value = header?.trim() ?? ""
  if (value === "") return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1_000
  // An HTTP date starts with a day name in all three legal spellings. `Date`
  // alone is far too forgiving ("1.5" parses as a date in V8).
  if (!/^[A-Za-z]{3,9},?\s/.test(value)) return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs)
}
