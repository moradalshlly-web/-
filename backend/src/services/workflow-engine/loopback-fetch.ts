/**
 * The orchestrator's ONE way of reaching this container's own API.
 *
 * A sync-HTTP node and a component node both run by POSTing to
 * `http://localhost:<BACKEND_PORT>/…`. When that call throws at the transport
 * level, Node wraps the real failure: `fetch()` always rejects with
 * `TypeError: fetch failed`, and the only thing that says WHAT happened is
 * `err.cause` (a `connect ECONNREFUSED`, a DNS answer, a socket the peer
 * closed, an invalid header). The orchestrator records `err.message`, so every
 * one of those collapsed to the same four characterless words — in the node
 * error, in the execution's `error_message`, in the `execution-failure`
 * app-report, and in what the user is shown.
 *
 * Production, 2026-09-14: three runs died with `Node <id> (llm-chat) failed:
 * fetch failed` and nothing else. The API was healthy throughout (it answered
 * loopback POSTs from the recast cron every five seconds), and no matching
 * `incoming request` was ever logged — so the request never reached Fastify.
 * Which transport failure it was is unrecoverable, because the cause was
 * dropped at the throw site. That is the gap this module closes: the next
 * occurrence names itself.
 *
 * Two behaviors, and the line between them is the one that matters:
 *
 *  1. DESCRIBE — the thrown error carries the cause chain's codes and message,
 *     always.
 *  2. RETRY — only when the failure PROVES the request was never delivered
 *     (the connection was never established). These POSTs are not idempotent:
 *     `/v1/llm-chat/generate` reserves credits and inserts a job before it
 *     answers. A socket that died mid-flight (`UND_ERR_SOCKET`, "other side
 *     closed", `ECONNRESET`) is indistinguishable from one the route received
 *     and is still working on, so retrying it would risk charging a user
 *     twice. It is described and rethrown, never retried.
 */
import { DrainAbortError, isWorkerDraining } from "../../lib/worker-drain.js"

/**
 * Transport codes that mean "no connection was ever established", so the
 * request cannot have been seen by the API. Anything else — including every
 * mid-flight socket error — is NOT in this set, on purpose (see the header).
 */
const NEVER_DELIVERED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
])

/** ~1.75s total across three attempts — long enough to ride out a listener
 *  that is restarting, short enough that a real outage still fails the node
 *  rather than parking the execution. */
const RETRY_DELAYS_MS: readonly number[] = [250, 1_500]

/** Every `{ code, message }` in the cause chain, outermost first. */
function causeChain(err: unknown): Array<{ code?: string; message?: string }> {
  const out: Array<{ code?: string; message?: string }> = []
  let cursor: unknown = err
  // Bounded: a malformed cause cycle must not spin.
  for (let depth = 0; cursor && typeof cursor === "object" && depth < 8; depth++) {
    const record = cursor as { code?: unknown; message?: unknown; cause?: unknown }
    out.push({
      code: typeof record.code === "string" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
    })
    if (record.cause === cursor) break
    cursor = record.cause
  }
  return out
}

/** True when the failure proves the API never received the request. */
export function isNeverDeliveredTransportError(err: unknown): boolean {
  return causeChain(err).some((link) => link.code !== undefined && NEVER_DELIVERED_CODES.has(link.code))
}

/**
 * `TypeError: fetch failed` → `fetch failed (ECONNREFUSED: connect ECONNREFUSED
 * 127.0.0.1:9000)`. The outer message stays first so existing log greps still
 * match; everything the cause chain knows follows it.
 */
export function describeFetchError(err: unknown): string {
  const chain = causeChain(err)
  const head = chain[0]?.message ?? String(err)
  const detail = chain
    .slice(1)
    .map((link) => [link.code, link.message].filter(Boolean).join(": "))
    .filter((text) => text.length > 0)
  return detail.length > 0 ? `${head} (${detail.join(" ← ")})` : head
}

export interface LoopbackFetchOptions {
  /** Label used in the thrown message, e.g. the route path. */
  label: string
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * POST to this container's own API, with the transport failure DESCRIBED and a
 * never-delivered failure retried.
 *
 * Reads `globalThis.fetch` at call time (not at import) so a test that stubs
 * the global still sees its stub.
 */
export async function loopbackFetch(
  url: string,
  init: RequestInit,
  { label, delaysMs = RETRY_DELAYS_MS, sleep = defaultSleep, fetchImpl }: LoopbackFetchOptions,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (fetchImpl ?? globalThis.fetch)(url, init)
    } catch (err) {
      // A dying container must not spend its drain window retrying: the
      // orchestrator's catch treats DrainAbortError as "put the job back",
      // which is what gets the run finished by the replacement process.
      if (isWorkerDraining()) throw new DrainAbortError()
      if (!isNeverDeliveredTransportError(err) || attempt >= delaysMs.length) {
        throw new Error(`${label}: ${describeFetchError(err)}`)
      }
      const delay = delaysMs[attempt]!
      console.warn(
        `[orchestrator] ${label} did not reach the API (${describeFetchError(err)}) — retry ${attempt + 1}/${delaysMs.length} in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
}
