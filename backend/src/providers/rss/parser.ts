/**
 * Minimal feed reader for the Web Scrape RSS actor — RSS 2.0 (and the older
 * 0.9x / 1.0 shapes, which use the same `<item>`) and Atom. No external
 * dependency. Every item, from either format, is the same five fields:
 *
 *   title, url, description, pubDate (ISO), guid
 *
 * Design: regex + string slicing, not a full XML parser. A feed has a narrow
 * enough shape that this is safe; what's out of scope:
 *   - Nested namespaced fields (media:content, content:encoded) — except
 *     `media:description`, the only place a YouTube entry keeps its text
 *   - Relative links (`xml:base`)
 *
 * Linear in the body — it is a stranger's 5 MB, read on the API's one event
 * loop; the rules are at the top of xml-text.ts.
 *
 * Malformed XML INSIDE a feed never throws: the items that can be recognised
 * are returned and the rest dropped. A document that is not a feed at all DOES
 * throw (see `parseRssXml`) — the route charges a completed run, and `[]` from
 * an HTML error page used to be one.
 */
import { URL } from "url"
import { isTransportError } from "../../lib/boot-retry.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { sleep } from "../../lib/sleep.js"
import { parseAtomEntry } from "./atom-entry.js"
import { notAFeedError, readDocumentRoot, withoutAtomRootPrefix } from "./feed-document.js"
import {
  MAX_RETRY_WAIT_MS,
  backoffDelayMs,
  parseRetryAfterMs,
  retriesAllowedFor,
  type FetchFailure,
} from "./retry-policy.js"
import type { RssItem } from "./types.js"
import { decodeXmlText, extractTag, maskCdata, normalisePubDate } from "./xml-text.js"

export type { RssItem } from "./types.js"

/** One retry about to happen — for the caller's log. */
export interface RssRetryInfo {
  /** The attempt that just failed (1 = the first request). */
  attempt: number
  delayMs: number
  /** `HTTP 503`, or the network error's message. Never the response body. */
  reason: string
}

export interface FetchRssOptions {
  url: string
  resultsLimit?: number
  fetchImpl?: typeof fetch
  /** Max bytes we'll accept from the feed response (default 5 MB). */
  maxBytes?: number
  /** Wall-clock budget in milliseconds for the WHOLE call — every attempt, every
   *  wait between them, and the body read (default 30s). */
  timeoutMs?: number
  /** Told about each retry before its wait starts. */
  onRetry?: (info: RssRetryInfo) => void
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

const USER_AGENT = "Nodaro-RSS/1.0 (+https://nodaro.ai)"

type AttemptOutcome =
  | { readonly ok: true; readonly xml: string }
  | {
      readonly ok: false
      readonly failure: FetchFailure
      readonly error: Error
      readonly reason: string
      readonly retryAfterMs?: number
    }

/**
 * Fetch the given RSS or Atom feed and return parsed items.
 *
 * Throws a plain Error on network failure, non-2xx response, oversized body,
 * or if the response wasn't recognisable as a feed. Callers should catch and
 * surface the message — matching the Apify scraper error contract.
 *
 * A failure that looks transient (a dropped connection, 429, 5xx — the rules
 * are in retry-policy.ts) is asked again a bounded number of times. `timeoutMs`
 * bounds the whole call, not each attempt, so a caller's budget is exactly what
 * it was before there were retries.
 */
export async function fetchRssItems(opts: FetchRssOptions): Promise<RssItem[]> {
  // Default to safeFetch so the RSS URL (user-supplied) is validated against
  // DNS resolution to private/reserved IPs at connection time. Tests inject
  // `fetchImpl` to bypass networking entirely.
  const fetchFn = (opts.fetchImpl ?? safeFetch) as typeof fetch
  const limit = clampLimit(opts.resultsLimit)
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Re-parse the URL so a second line of defence rejects javascript:, data:,
  // etc. even if the caller skipped Zod validation.
  const parsed = new URL(opts.url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported RSS URL protocol: ${parsed.protocol}`)
  }

  const controller = new AbortController()
  // The timer must cover body streaming too, not just the initial fetch + headers.
  // undici resolves the Response as soon as headers land; if clearTimeout ran in
  // a finally around just the fetch, a slowloris-style server trickling body bytes
  // would have no wall-clock bound — it could stall readLimited until it either
  // hit maxBytes or Fastify's 10-min request timeout.
  //
  // ONE timer for every attempt: a retry is given what is left of the budget,
  // never a fresh one, and a retry that hangs is cut off like a first attempt.
  const deadline = Date.now() + timeoutMs
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let lastReason: string | undefined
  try {
    for (let attempt = 1; ; attempt++) {
      const outcome = await attemptFetch(fetchFn, opts.url, controller.signal, maxBytes)
      // Parsed HERE, outside the attempt's transport classifier: what the parser
      // says about a document is a verdict, and its message quotes the document's
      // root element — text the upstream chose, which must never be able to read
      // as a network failure and buy itself a retry.
      if (outcome.ok) return parseRssXml(outcome.xml, limit)

      lastReason = outcome.reason
      const delayMs = retryDelayMs(outcome, attempt, deadline)
      if (delayMs === undefined) throw outcome.error
      opts.onRetry?.({ attempt, delayMs, reason: outcome.reason })
      await sleep(delayMs)
    }
  } catch (err) {
    if (!controller.signal.aborted) throw err
    // The budget ran out. Say so — and say what the upstream last answered, which
    // is the useful half when the run died during a retry.
    const last = lastReason === undefined ? "" : ` (last answer: ${lastReason})`
    throw new Error(`RSS fetch timed out after ${timeoutMs} ms${last}`, { cause: err })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * One request. Resolves with the body text, or with a failure the policy MAY
 * retry; throws everything that asking again cannot change — the budget running
 * out, an address the SSRF guard refused, a feed that is too large.
 */
async function attemptFetch(
  fetchFn: typeof fetch,
  url: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<AttemptOutcome> {
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
      },
      redirect: "follow",
      signal,
    })

    if (!response.ok) {
      const reason = `HTTP ${response.status}`
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
      // The body of a failed answer is never read: release it, or the
      // connection stays checked out for as long as the upstream trickles it.
      // Not awaited — a cancel that never settles (one branch of a tee'd body
      // waits for the other) must not be able to hold the run.
      void response.body?.cancel().catch(() => {})
      return {
        ok: false,
        failure: { kind: "http", status: response.status },
        error: new Error(`RSS fetch failed: ${reason}`),
        reason,
        retryAfterMs,
      }
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0")
    if (contentLength > maxBytes) {
      throw new Error(`RSS feed too large: ${contentLength} bytes (max ${maxBytes})`)
    }

    return { ok: true, xml: await readLimited(response, maxBytes) }
  } catch (err) {
    // An abort is the budget running out — there is nothing left to retry in.
    // Anything that is not a transport failure is a verdict.
    if (signal.aborted || !isTransportError(err)) throw err
    const error = err instanceof Error ? err : new Error(String(err))
    return { ok: false, failure: { kind: "network" }, error, reason: error.message }
  }
}

/** How long to wait before the next attempt, or `undefined` when this failure is final. */
function retryDelayMs(
  outcome: Extract<AttemptOutcome, { ok: false }>,
  attempt: number,
  deadline: number,
): number | undefined {
  if (attempt > retriesAllowedFor(outcome.failure)) return undefined
  // An upstream that names its own wait is believed — never asked sooner.
  const delayMs = Math.max(backoffDelayMs(attempt), outcome.retryAfterMs ?? 0)
  if (delayMs > MAX_RETRY_WAIT_MS) return undefined
  // Never start a wait the budget cannot outlast.
  if (Date.now() + delayMs >= deadline) return undefined
  return delayMs
}

function clampLimit(n: number | undefined): number {
  const v = n ?? DEFAULT_LIMIT
  if (!Number.isFinite(v) || v < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(v), MAX_LIMIT)
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  // Buffer bytes (still capped at maxBytes) so we can inspect the XML prolog
  // for an `encoding="…"` declaration before decoding. Feeds commonly declare
  // ISO-8859-1 or windows-1252; decoding those as utf-8 produces garbled
  // titles/descriptions. At 5 MB the memory overhead is negligible.
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      reader.cancel().catch(() => {})
      throw new Error(`RSS feed too large: over ${maxBytes} bytes`)
    }
    chunks.push(value)
  }

  const bytes = concatChunks(chunks, total)
  const encoding = detectEncoding(bytes)
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes)
  } catch {
    // TextDecoder throws RangeError on unknown labels (e.g. a typo in the
    // prolog). Fall back to utf-8 so a malformed header doesn't take the
    // whole fetch down.
    return new TextDecoder("utf-8").decode(bytes)
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function detectEncoding(bytes: Uint8Array): string {
  // Byte-order marks are authoritative when present (XML 1.0 Appendix F).
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8"
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"

  // Look for `encoding="…"` in the first 1 KB. Encoding names are ASCII so the
  // preview decodes safely regardless of the actual body encoding.
  const previewLen = Math.min(bytes.length, 1024)
  const preview = new TextDecoder("ascii", { fatal: false }).decode(bytes.subarray(0, previewLen))
  const match = /<\?xml\b[^?]*\bencoding=["']([^"']+)["']/i.exec(preview)
  if (match) return match[1].toLowerCase()

  return "utf-8"
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractLink(block: string): string {
  // RSS 2.0 uses <link>URL</link>. Atom-style <link href="..."/> is a common
  // fallback — handle it so mildly non-conformant feeds still yield a URL.
  const plain = extractTag(block, "link")
  if (plain) return plain
  // [^<>], not [^>]: a tag never crosses a "<" — which is what keeps a body of
  // "<link " repeated a million times from being re-scanned from every one.
  const atomMatch = /<link\b[^<>]*\bhref=["']([^"'<>]+)["'][^<>]*\/?>/i.exec(block)
  return atomMatch ? decodeXmlText(atomMatch[1]) : ""
}

function parseRssItem(block: string): RssItem {
  const title = extractTag(block, "title")
  const url = extractLink(block)
  const description = extractTag(block, "description")
  const pubDate = normalisePubDate(extractTag(block, "pubDate"))
  // Prefer <guid> but fall back to the item URL so downstream dedupe still
  // has a stable key when a feed omits the tag.
  const guid = extractTag(block, "guid") || url
  return { title, url, description, pubDate, guid }
}

interface FeedBlock {
  readonly kind: "item" | "entry"
  readonly body: string
}

type BlockKind = FeedBlock["kind"]

/**
 * The first `limit` RSS `<item>` and Atom `<entry>` blocks, in document order.
 *
 * Blocks are LOCATED in a view with the CDATA blanked out — a post that quotes
 * `</entry>` in its text does not end the entry — and READ from the document.
 *
 * One forward pass. The single-pattern spelling (an opening tag, a lazy body,
 * the closing tag) scans to the end of the document from EVERY opening tag that
 * has no closing tag — quadratic on a body of `<entry>` repeated. Here a kind
 * whose closing tag is not found once is never searched for again, and the pass
 * stops at `limit` blocks instead of collecting all of them.
 */
function findFeedBlocks(xml: string, limit: number): FeedBlock[] {
  const view = maskCdata(xml)
  const open = /<(item|entry)(?=[\s/>])[^<>]*>/gi
  const close: Record<BlockKind, RegExp> = { item: /<\/item>/gi, entry: /<\/entry>/gi }
  const unclosed = new Set<BlockKind>()
  const blocks: FeedBlock[] = []

  let cursor = 0
  while (blocks.length < limit) {
    open.lastIndex = cursor
    const opening = open.exec(view)
    if (!opening) break
    cursor = open.lastIndex
    const kind: BlockKind = opening[1].toLowerCase() === "entry" ? "entry" : "item"
    if (opening[0].endsWith("/>")) {
      blocks.push({ kind, body: "" })
      continue
    }
    if (unclosed.has(kind)) continue
    close[kind].lastIndex = cursor
    const closing = close[kind].exec(view)
    if (!closing) {
      unclosed.add(kind)
      continue
    }
    blocks.push({ kind, body: xml.slice(cursor, closing.index) })
    cursor = close[kind].lastIndex
  }
  return blocks
}

/**
 * Items of an RSS or Atom document, capped at `limit` (hard cap 50).
 *
 * Returns `[]` for a VALID feed that has nothing in it — a recognised root
 * (`<rss>`, `<rdf:RDF>`, `<feed>`) and no items. Throws for a document that is
 * not a feed: no items AND no recognised root (an HTML error page, JSON,
 * garbage). The two used to be the same `[]`, and the route charges a completed
 * run — a not-a-feed answer now reaches its failure path, which refunds.
 *
 * Items win over the root check, so nothing that parsed before stops parsing:
 * a feed whose server printed a warning ahead of the XML declaration has no
 * readable root, and still has its items.
 */
export function parseRssXml(xml: string, limit = DEFAULT_LIMIT): RssItem[] {
  const root = readDocumentRoot(xml)
  const blocks = findFeedBlocks(withoutAtomRootPrefix(xml, root), clampLimit(limit))
  if (blocks.length === 0 && !root.isFeed) throw notAFeedError(root, xml)
  return blocks.map((block) => (block.kind === "entry" ? parseAtomEntry(block.body) : parseRssItem(block.body)))
}
