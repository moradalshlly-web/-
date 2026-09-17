/**
 * MEDIA PROXY — one cached, cheap-to-analyse rendition per source.
 *
 * WHY THIS EXISTS
 * The podcast-editing analysis nodes (`transcribe`, `silence-detect`,
 * `audio-sync`, `edit-plan`, later `speaker-frames`) must not each download and
 * decode a multi-GB original. They read a PROXY instead: a 16 kHz mono AAC
 * audio track, or a 360p low-fps video for detection/review. The render nodes
 * (`apply-edl`, `speaker-view`) keep reading the ORIGINAL. This is what makes a
 * 90-minute episode analysable in minutes and keeps vendor uploads small.
 *
 * The proxy is content-addressed and cached in R2, so re-analysing the same
 * source is a HEAD, not a re-encode. This is a worker STEP (a plain async
 * function), not a node — callers invoke `ensureMediaProxy` when they need one.
 *
 * ffmpeg runs through `runFfmpeg`, which is already FIFO-semaphore-gated
 * (`withFfmpegSlot`), so a proxy encode shares the process-wide ffmpeg slot
 * budget with every other ffmpeg job. A 3-hour source can exceed the default
 * 10-minute per-spawn timeout, so this passes an explicit longer one.
 *
 * KEYING: the cache key is derived from the source IDENTITY — the R2 object key
 * for our own URLs (already content-addressed per job), else the URL string —
 * NOT a byte hash of the source (that would require downloading before the
 * cache check could run). So two different URLs serving byte-identical content
 * do not dedupe; the same source URL always hits. That is the right trade for
 * the common case; a byte/ETag-level key is a future refinement.
 */
import { createHash } from "node:crypto"
import { join } from "node:path"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  runFfmpeg,
} from "../providers/video/ffmpeg-utils.js"
import {
  getR2ObjectSize,
  r2KeyFromOurUrl,
  r2Url,
  uploadLocalFileToR2Key,
} from "../lib/storage.js"

/** Kinds of proxy a caller can ask for. */
export type MediaProxyKind = "audio" | "video"

export interface MediaProxyResult {
  /** Public R2 URL of the cached proxy. */
  readonly url: string
  /** R2 object key. */
  readonly key: string
  readonly kind: MediaProxyKind
  /** True when the proxy already existed in R2 (no encode ran). */
  readonly cached: boolean
}

export interface MediaProxyOptions {
  /** Video proxy frame rate. 2 fps for frame-by-frame detection, ~15 fps for
   *  review. Ignored for audio. Default 15. */
  readonly fps?: number
  /** Override the per-spawn ffmpeg timeout (ms). Default handles a ~3h source. */
  readonly timeoutMs?: number
}

/** Audio proxy: 16 kHz mono AAC — everything a transcriber / silence pass needs. */
const AUDIO_PROXY = { sampleRateHz: 16_000, bitrate: "64k", ext: "m4a", contentType: "audio/mp4" } as const
/** Video proxy: 360p, low fps, no audio — for detection / review. */
const VIDEO_PROXY = { height: 360, defaultFps: 15, crf: 30, ext: "mp4", contentType: "video/mp4" } as const

/** A 3-hour 360p / 16 kHz proxy encode can run well past the default 10-minute
 *  per-spawn ffmpeg timeout. 45 minutes is a generous ceiling; the encode is
 *  faster-than-realtime at these settings, so this is a backstop, not a target. */
const PROXY_FFMPEG_TIMEOUT_MS = 45 * 60_000

/** The stable identity a proxy is keyed on: our own object key when the source
 *  is an R2 URL (content-addressed per job), else the URL verbatim. */
function sourceIdentity(sourceUrl: string): string {
  return r2KeyFromOurUrl(sourceUrl) ?? sourceUrl
}

/** Content-addressed cache key. The variant (kind + fps for video) is part of
 *  the key so an audio proxy, a 2-fps detection proxy and a 15-fps review proxy
 *  of the same source never collide. */
export function mediaProxyKey(sourceUrl: string, kind: MediaProxyKind, fps?: number): string {
  const variant = kind === "video" ? `video@${fps ?? VIDEO_PROXY.defaultFps}fps` : "audio"
  const hash = createHash("sha256").update(`${sourceIdentity(sourceUrl)}::${variant}`).digest("hex").slice(0, 40)
  const ext = kind === "audio" ? AUDIO_PROXY.ext : VIDEO_PROXY.ext
  return `proxies/${hash}/${variant}.${ext}`
}

function buildProxyArgs(kind: MediaProxyKind, src: string, out: string, fps: number): string[] {
  if (kind === "audio") {
    return [
      "-y", "-i", src,
      "-vn", // drop video
      "-ac", "1",
      "-ar", String(AUDIO_PROXY.sampleRateHz),
      "-c:a", "aac", "-b:a", AUDIO_PROXY.bitrate,
      out,
    ]
  }
  return [
    "-y", "-i", src,
    "-an", // a detection/review proxy carries no audio
    // scale to 360p tall, keep aspect, force even width (libx264 needs it)
    "-vf", `scale=-2:${VIDEO_PROXY.height}`,
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(VIDEO_PROXY.crf),
    "-pix_fmt", "yuv420p",
    out,
  ]
}

/**
 * Return a cached proxy of `sourceUrl`, generating and caching it on first use.
 * Idempotent and safe to call from many workers: concurrent misses both encode
 * and both write the SAME content-addressed key (last write wins, content is
 * equivalent) — a benign race, not corruption.
 */
export async function ensureMediaProxy(
  sourceUrl: string,
  kind: MediaProxyKind,
  opts: MediaProxyOptions = {},
): Promise<MediaProxyResult> {
  const fps = opts.fps ?? VIDEO_PROXY.defaultFps
  const key = mediaProxyKey(sourceUrl, kind, fps)

  // Cache check: a HEAD, not a download.
  if (await getR2ObjectSize(key) > 0) {
    return { url: r2Url(key), key, kind, cached: true }
  }

  const workDir = await createWorkDir("media-proxy")
  try {
    const src = join(workDir, "source")
    await downloadFile(sourceUrl, src)
    const proxyExt = kind === "audio" ? AUDIO_PROXY.ext : VIDEO_PROXY.ext
    const out = join(workDir, `proxy.${proxyExt}`)
    await runFfmpeg(buildProxyArgs(kind, src, out, fps), opts.timeoutMs ?? PROXY_FFMPEG_TIMEOUT_MS)
    const contentType = kind === "audio" ? AUDIO_PROXY.contentType : VIDEO_PROXY.contentType
    const url = await uploadLocalFileToR2Key(out, key, contentType)
    return { url, key, kind, cached: false }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
