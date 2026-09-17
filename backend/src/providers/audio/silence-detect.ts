/**
 * SILENCE DETECT — one ffmpeg `silencedetect` pass over an audio/video source,
 * returning the silence spans as `{ startMs, endMs }` ranges on the source's
 * own clock.
 *
 * WHY A PROXY. A podcast episode is a multi-GB original; every silence pass
 * only needs amplitude, so `detectSilence` reads the cached 16 kHz mono AAC
 * media proxy (`ensureMediaProxy`) instead of the original — the same proxy
 * `transcribe` reads, so a Tighten-episode workflow encodes it once.
 *
 * `silencedetect` is a METADATA-ONLY filter: it decodes the whole track and
 * emits `silence_start: <sec>` / `silence_end: <sec>` markers on STDERR without
 * transforming a sample (see the identical use in
 * `ee/pipelines/services/pipeline-extract-beat-grid.ts`). We run it with
 * `-f null -` so nothing is written, parse the markers, and pair them into
 * ranges.
 *
 * PADDING. `padMs` shrinks each detected silence INWARD by `padMs` at both ends
 * so a downstream cut keeps a little room around speech onsets/tails and never
 * clips a breath or a word's attack. A range that collapses to nothing after
 * padding is dropped.
 *
 * The pure parse (`parseSilenceRanges`) and the local-file pass
 * (`runSilenceDetectOnFile`) are exported so the ffmpeg pass can be exercised
 * end-to-end against a synthetic lavfi fixture without any network/R2.
 */
import { join } from "node:path"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  runFfmpegCapture,
  probeMediaDuration,
} from "../video/ffmpeg-utils.js"
import { ensureMediaProxy } from "../../services/media-proxy.js"

/** Wire version of the emitted `data` payload. Bump only on a breaking shape
 *  change (a new major of the node's output contract). */
export const SILENCE_DETECT_VERSION = 1 as const

export interface SilenceRange {
  /** Silence start on the SOURCE clock, integer ms. */
  readonly startMs: number
  /** Silence end on the SOURCE clock, exclusive, integer ms, > startMs. */
  readonly endMs: number
}

export interface SilenceDetectResult {
  readonly version: typeof SILENCE_DETECT_VERSION
  readonly ranges: SilenceRange[]
  /** Total source duration, integer ms. */
  readonly durationMs: number
}

export interface SilenceDetectSettings {
  /** RMS threshold below which a span counts as silence, in dBFS (negative).
   *  Default -35. */
  readonly thresholdDb: number
  /** Minimum span length to report, ms. Default 700. */
  readonly minSilenceMs: number
  /** Padding kept around speech, ms — shrinks each range inward by this at both
   *  ends. Default 120. */
  readonly padMs: number
}

export const SILENCE_DETECT_DEFAULTS: SilenceDetectSettings = {
  thresholdDb: -35,
  minSilenceMs: 700,
  padMs: 120,
}

/**
 * Parse `silencedetect` stderr markers into padded, clamped source-clock
 * ranges. Pure — no ffmpeg. Pairs each `silence_start` with the next
 * `silence_end`; a dangling `silence_start` (source ends mid-silence) is closed
 * at `durationMs`. Applies `padMs` inward and drops ranges that collapse.
 *
 * Format (ffmpeg):
 *   [silencedetect @ 0x…] silence_start: 12.345
 *   [silencedetect @ 0x…] silence_end: 15.678 | silence_duration: 3.333
 */
export function parseSilenceRanges(
  stderr: string,
  opts: { padMs: number; durationMs: number },
): SilenceRange[] {
  const pad = Math.max(0, Math.round(opts.padMs))
  const durationMs = Math.max(0, Math.round(opts.durationMs))
  const ranges: SilenceRange[] = []

  let openStartMs: number | null = null
  // Scan line by line so start/end stay in emission order even if a stray
  // token appears elsewhere on a line.
  for (const line of stderr.split("\n")) {
    const startMatch = /silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/.exec(line)
    if (startMatch) {
      // A new start before the previous one closed (shouldn't happen, but be
      // defensive): drop the earlier unterminated span.
      openStartMs = Math.max(0, Math.round(parseFloat(startMatch[1]!) * 1000))
      continue
    }
    const endMatch = /silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)/.exec(line)
    if (endMatch && openStartMs !== null) {
      const endMs = Math.max(0, Math.round(parseFloat(endMatch[1]!) * 1000))
      pushPadded(ranges, openStartMs, endMs, pad)
      openStartMs = null
    }
  }
  // Source ended while still silent — close the final span at the duration.
  if (openStartMs !== null && durationMs > openStartMs) {
    pushPadded(ranges, openStartMs, durationMs, pad)
  }
  return ranges
}

function pushPadded(out: SilenceRange[], rawStartMs: number, rawEndMs: number, pad: number): void {
  const startMs = rawStartMs + pad
  const endMs = rawEndMs - pad
  // Drop spans that vanish (or invert) once the pad is applied on both sides.
  if (endMs > startMs) out.push({ startMs, endMs })
}

/**
 * Run one `silencedetect` pass over a LOCAL media file and return the padded
 * ranges + the file's duration. Real ffmpeg; no network. This is the unit the
 * lavfi e2e test drives directly.
 */
export async function runSilenceDetectOnFile(
  localPath: string,
  settings: SilenceDetectSettings = SILENCE_DETECT_DEFAULTS,
  timeoutMs?: number,
): Promise<SilenceDetectResult> {
  const noiseDb = -Math.abs(settings.thresholdDb) // guard: always a cut BELOW 0 dBFS
  const durationSec = settings.minSilenceMs / 1000

  let stderr = ""
  try {
    const res = await runFfmpegCapture(
      [
        "-hide_banner", "-nostats",
        "-i", localPath,
        "-af", `silencedetect=noise=${noiseDb}dB:d=${durationSec}`,
        "-f", "null", "-",
      ],
      timeoutMs,
    )
    stderr = res.stderr
  } catch (err) {
    // `-f null -` normally exits 0, but keep the fallback the beat-grid path
    // uses: runFfmpegCapture attaches the full stderr to the thrown error, and
    // the markers we need are on it even when ffmpeg exits non-zero.
    const e = err as { stderr?: string }
    if (!e?.stderr) throw err
    stderr = e.stderr
  }

  const durationMs = Math.round((await probeMediaDuration(localPath)) * 1000)
  const ranges = parseSilenceRanges(stderr, { padMs: settings.padMs, durationMs })
  return { version: SILENCE_DETECT_VERSION, ranges, durationMs }
}

/**
 * Detect silence in a remote audio/video source. Fetches (or reuses) the cached
 * 16 kHz mono audio proxy, downloads that small proxy locally, and runs one
 * `silencedetect` pass over it. Called from the video worker under the shared
 * ffmpeg slot (via `runFfmpegCapture`).
 */
export async function detectSilence(
  sourceUrl: string,
  settings: SilenceDetectSettings = SILENCE_DETECT_DEFAULTS,
): Promise<SilenceDetectResult> {
  const proxy = await ensureMediaProxy(sourceUrl, "audio")
  const workDir = await createWorkDir("silence-detect")
  try {
    const local = join(workDir, "proxy.m4a")
    await downloadFile(proxy.url, local)
    return await runSilenceDetectOnFile(local, settings)
  } finally {
    await cleanupWorkDir(workDir)
  }
}
