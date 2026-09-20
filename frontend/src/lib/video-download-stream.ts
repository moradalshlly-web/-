/**
 * Follow one server-side video download to its end.
 *
 * `POST /v1/download-video` answers with a `downloadId` and does the work in
 * the background; `GET /v1/download-video/progress/:id` streams
 * `{ phase, percent, videoUrl?, error? }` twice a second until `completed` or
 * `failed`. The server keeps the download for minutes after it ends, so a
 * dropped stream is NOT a failed download — this reader reconnects, and only
 * ever reports four honest endings:
 *
 *   completed — here is the file
 *   failed    — the server said so, in its own words
 *   expired   — the server no longer knows this download (404): it is gone for
 *               good, and the caller may start a fresh one
 *   lost      — the stream kept breaking past the reconnect budget, or the
 *               download stopped MOVING for longer than any honest one does:
 *               it may well still land; say "connection", not "failed"
 *
 * It reads the stream with `fetch`, not `EventSource`. `EventSource` hides the
 * HTTP status, so a 404 and a flaky network looked the same, and its first
 * `onerror` used to be reported as "Connection lost" while the video went on
 * to land server-side — a failed node over a finished, stored download.
 */
import { runtimeApiUrl } from "@/lib/runtime-config"

export type VideoDownloadPhase = "downloading" | "processing" | "uploading"

export interface VideoDownloadProgress {
  readonly phase: VideoDownloadPhase
  readonly percent: number
}

export type VideoDownloadOutcome =
  | { readonly status: "completed"; readonly videoUrl: string; readonly thumbnailUrl?: string }
  | { readonly status: "failed"; readonly error?: string }
  | { readonly status: "expired" }
  | { readonly status: "lost" }
  | { readonly status: "aborted" }

export interface FollowVideoDownloadOptions {
  onProgress(progress: VideoDownloadProgress): void
  readonly signal?: AbortSignal
  /** Consecutive reconnects with no frame in between before giving up as `lost`. */
  readonly maxReconnects?: number
  readonly reconnectDelayMs?: number
  /** How long the download may report the SAME phase and percent before the
   *  follower stops waiting (`lost`). The server sends a frame twice a second
   *  for as long as it holds the download, so a quiet line is not the signal —
   *  a download that never moves is. */
  readonly stallMs?: number
  /** Test seam. */
  readonly now?: () => number
  /** Test seam. */
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

const DEFAULT_MAX_RECONNECTS = 5
const DEFAULT_RECONNECT_DELAY_MS = 1000
/** A part of a long video can sit at one percent for minutes while ffmpeg cuts
 *  it, and the server has its own watchdogs for a dead tool — so this is long. */
const DEFAULT_STALL_MS = 15 * 60 * 1000
/** The server's wording when the download's record disappears mid-stream. */
const EXPIRED_MESSAGE = "download expired"

type Frame =
  | { readonly type: "progress"; readonly progress: VideoDownloadProgress }
  | { readonly type: "end"; readonly outcome: VideoDownloadOutcome }
  | { readonly type: "ignore" }

function readFrame(raw: unknown): Frame {
  if (typeof raw !== "object" || raw === null) return { type: "ignore" }
  const event = raw as Record<string, unknown>
  if (event.phase === "completed") {
    // A completed frame with no file is nothing to resolve to — keep reading.
    if (typeof event.videoUrl !== "string" || event.videoUrl === "") return { type: "ignore" }
    return {
      type: "end",
      outcome: typeof event.thumbnailUrl === "string" && event.thumbnailUrl !== ""
        ? { status: "completed", videoUrl: event.videoUrl, thumbnailUrl: event.thumbnailUrl }
        : { status: "completed", videoUrl: event.videoUrl },
    }
  }
  if (event.phase === "failed") {
    const error = typeof event.error === "string" ? event.error : undefined
    if (error && error.toLowerCase() === EXPIRED_MESSAGE) return { type: "end", outcome: { status: "expired" } }
    return { type: "end", outcome: error ? { status: "failed", error } : { status: "failed" } }
  }
  if (event.phase === "downloading" || event.phase === "processing" || event.phase === "uploading") {
    const percent = typeof event.percent === "number" && Number.isFinite(event.percent) ? event.percent : 0
    return { type: "progress", progress: { phase: event.phase, percent } }
  }
  return { type: "ignore" }
}

/** Parse the `data:` lines of one SSE block; comments and junk are skipped. */
function framesOf(block: string): Frame[] {
  const frames: Frame[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    try {
      frames.push(readFrame(JSON.parse(line.slice(5).trim())))
    } catch {
      // A malformed frame is not worth losing the download over.
    }
  }
  return frames
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}

/**
 * One connection's worth of reading. Resolves with the outcome when a terminal
 * frame arrives, or `null` when the stream ended / broke without one.
 * `sawFrame` tells the caller the connection was alive (resets its budget).
 */
async function readOnce(
  url: string,
  opts: FollowVideoDownloadOptions,
  fetchImpl: NonNullable<FollowVideoDownloadOptions["fetchImpl"]>,
  movement: { last: string; since: number; readonly stallMs: number; readonly now: () => number },
): Promise<{ outcome: VideoDownloadOutcome | null; sawFrame: boolean }> {
  let sawFrame = false
  let response: Response
  try {
    response = await fetchImpl(url, { signal: opts.signal, headers: { Accept: "text/event-stream" } })
  } catch {
    return { outcome: null, sawFrame }
  }
  if (response.status === 404) return { outcome: { status: "expired" }, sawFrame }
  if (!response.ok || !response.body) return { outcome: null, sawFrame }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // A gateway may rewrite line endings; the spec allows CRLF framing.
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ""
      for (const block of blocks) {
        for (const frame of framesOf(block)) {
          if (frame.type === "ignore") continue
          sawFrame = true
          if (frame.type === "end") return { outcome: frame.outcome, sawFrame }
          const position = `${frame.progress.phase}|${frame.progress.percent}`
          if (position !== movement.last) {
            movement.last = position
            movement.since = movement.now()
          } else if (movement.now() - movement.since >= movement.stallMs) {
            return { outcome: { status: "lost" }, sawFrame }
          }
          opts.onProgress(frame.progress)
        }
      }
    }
  } catch {
    // Torn mid-read — same as an ended stream: the caller reconnects.
  } finally {
    reader.cancel().catch(() => {})
  }
  return { outcome: null, sawFrame }
}

export async function followVideoDownload(
  downloadId: string,
  opts: FollowVideoDownloadOptions,
): Promise<VideoDownloadOutcome> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const maxReconnects = opts.maxReconnects ?? DEFAULT_MAX_RECONNECTS
  const delayMs = opts.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
  // Straight to the API, not through the dev proxy — a proxy that buffers the
  // response delivers the whole stream at the end, and the progress with it.
  const url = `${runtimeApiUrl()}/v1/download-video/progress/${encodeURIComponent(downloadId)}`
  const now = opts.now ?? (() => Date.now())
  const movement = { last: "", since: now(), stallMs: opts.stallMs ?? DEFAULT_STALL_MS, now }

  let reconnects = 0
  for (;;) {
    if (opts.signal?.aborted) return { status: "aborted" }
    const { outcome, sawFrame } = await readOnce(url, opts, fetchImpl, movement)
    if (opts.signal?.aborted) return { status: "aborted" }
    if (outcome) return outcome
    // A connection that delivered frames was healthy — only back-to-back dead
    // connections count against the budget.
    reconnects = sawFrame ? 1 : reconnects + 1
    if (reconnects > maxReconnects) return { status: "lost" }
    await sleep(delayMs, opts.signal)
  }
}
