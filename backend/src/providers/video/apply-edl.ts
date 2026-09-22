/**
 * apply-edl executor — render an EDL into ONE media file (video OR audio).
 *
 * The EDL's segment ORDER is the output timeline. Each segment names a source
 * time-window on the MASTER clock; we trim every referenced source at
 * `masterMs − offsetMs(source)` (D19 sign), normalize picture to one canvas,
 * and JOIN the segments pairwise — a `cut` boundary abuts (`concat`), a
 * `crossfade` boundary overlaps (`xfade` video / `acrossfade` audio), so the
 * rendered length is the D17 overlap-compressed `edlDurationMs(edl)`.
 *
 * Audio doctrine: when a `role:"master-audio"` source exists, EVERY segment's
 * sound comes from it (a camera switch never touches the sound); otherwise each
 * segment uses its own `audio` (defaulting to its `video` source). Both are
 * trimmed to the SAME master-time windows and joined with the SAME boundaries,
 * so picture and sound stay locked.
 *
 * Long edits (> `chunkThreshold` segments) render in chunks split ONLY at
 * hard-cut boundaries (an xfade cannot straddle a chunk), each checkpointed to
 * R2 so a worker restart resumes instead of re-rendering, then joined with a
 * stream-copy concat. The checkpoint cache (`apply-edl-cache/<jobId>/…`) is
 * internal scratch: uploaded with NO `trackUserId` so it never bills the user's
 * storage quota, and best-effort deleted once the final concat succeeds.
 */
import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { Edl, EdlSegment, EdlSource } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import {
  downloadFile,
  runFfmpeg,
  runFfprobe,
  probeStreamEnds,
  type StreamEnds,
  createWorkDir,
  cleanupWorkDir,
  COMBINE_DELIVERY_CRF,
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
} from "./ffmpeg-utils.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { pickTargetResolution, pickTargetFps } from "./combine-videos.js"

export interface ApplyEdlOptions {
  readonly edl: Edl
  readonly output: "video" | "audio"
  readonly quality: "proxy" | "final"
  readonly jobId: string
  readonly jobUserId?: string
  /** 0..1 render progress. */
  readonly onProgress?: (fraction: number) => void
  /** Segments per render chunk (default 100). A chunk is closed only at a
   *  hard-cut boundary, so a long xfade run may exceed this. */
  readonly maxSegmentsPerChunk?: number
  /** At or below this many segments the whole edit renders in ONE pass with no
   *  R2 checkpoint (default 200). Lower it to force the chunked path (tests). */
  readonly chunkThreshold?: number
  /** R2 checkpointing (default true). Off = pure-local render (unit tests with
   *  no storage). */
  readonly checkpoint?: boolean
}

export interface ApplyEdlResult {
  readonly outputPath: string
  /** Rendered duration in ms — equals `edlDurationMs(edl)` by construction. */
  readonly durationMs: number
}

export const DEFAULT_MAX_SEGMENTS_PER_CHUNK = 100
export const DEFAULT_CHUNK_THRESHOLD = 200

/** ffmpeg kill budget per chunk: this many seconds of wall clock per second of
 *  output, with `CHUNK_RENDER_TIMEOUT_FLOOR_MS` as the floor — a hung encode
 *  is killed by its own spawn, not by anything watching from outside. */
export const CHUNK_RENDER_SECS_PER_OUTPUT_SEC = 6
export const CHUNK_RENDER_TIMEOUT_FLOOR_MS = 20 * 60_000

const secs = (ms: number): number => ms / 1000
const offsetOf = (s: EdlSource | undefined): number => s?.offsetMs ?? 0

/** The overlap (seconds) at the boundary INTO `seg`, clamped PER-BOUNDARY to
 *  `0.9·min(adjacent)` (R5 silent-edit guard: never a global clamp). Only a
 *  `crossfade` segment-transition consumes time in phase 1 (layout xfades are
 *  phase 2). */
function boundaryOverlapSecs(seg: EdlSegment, prev: EdlSegment): number {
  const t = seg.transition
  if (!t || t.type !== "crossfade") return 0
  const d = t.durationMs ?? 0
  if (d <= 0) return 0
  const minAdj = Math.min(seg.outMs - seg.inMs, prev.outMs - prev.inMs)
  return secs(Math.min(d, Math.floor(0.9 * minAdj)))
}

/** Resolve the source id that supplies a segment's SOUND (D19 audio doctrine). */
function audioSourceId(edl: Edl, seg: EdlSegment, masterAudioId: string | undefined): string | undefined {
  if (seg.audio) return seg.audio
  if (masterAudioId) return masterAudioId
  return seg.video
}

/** How far past a track's measured end a segment may reach before it is a
 *  refusal rather than rounding — see `assertSegmentsWithinSources`. Inside
 *  it the render reads to whatever the track actually has (a transcript's last
 *  word can end a beat after the audio; a clip's audio outlasts its picture by
 *  a frame or two). NOTE: per-segment frame quantization can still drift the
 *  picture against the sound over many fractional-length segments — the
 *  cumulative frame-grid fix is Track 0.14, out of scope for this PR. */
export const SOURCE_END_TOLERANCE_SEC = 1

/** A read the window check could not verify, for the caller to log. */
export interface SkippedWindowRead {
  readonly segment: string
  readonly source: string
  readonly track: "video" | "audio"
  readonly reason: string
}

/** Throws a `DeterministicJobError` — the same inputs fail the same way on a
 *  retry, so the job fails and refunds now — naming the segment, the source
 *  and the TRACK when a segment reads media that is not there:
 *   - its window reaches more than `SOURCE_END_TOLERANCE_SEC` past the end of
 *     the track it reads: the picture source's VIDEO track (video output
 *     only), the sound source's AUDIO track always — a file whose tracks differ
 *     in length is two lengths, not one;
 *   - its picture source has no video track at all (an audio file, or an mp3
 *     whose only "video" is cover art) — the render would otherwise fail on an
 *     empty stream specifier, or show a still.
 *  A sound source with no audio track is not a refusal: the render pads that
 *  segment with silence. A track present but unmeasured is skipped and
 *  RETURNED, so the caller can log it — a skipped check always leaves a trace.
 *  Pure; the measured ends (`probeStreamEnds`) are passed in, and a source
 *  with no entry at all (its probe failed outright) is skipped silently here
 *  because the caller already logged that failure. */
export function assertSegmentsWithinSources(
  edl: Edl,
  masterAudioId: string | undefined,
  wantVideo: boolean,
  sourceEnds: ReadonlyMap<string, StreamEnds>,
): SkippedWindowRead[] {
  const skipped: SkippedWindowRead[] = []
  edl.segments.forEach((seg, i) => {
    const reads: Array<{ id: string; track: "video" | "audio" }> = []
    if (wantVideo && seg.video) reads.push({ id: seg.video, track: "video" })
    const aId = audioSourceId(edl, seg, masterAudioId)
    if (aId) reads.push({ id: aId, track: "audio" })
    for (const { id, track } of reads) {
      const t = sourceEnds.get(id)?.[track]
      if (t === undefined) continue
      if (t.state === "absent") {
        if (track === "video") {
          throw new DeterministicJobError(
            `apply-edl: segment[${i}] "${seg.id}" takes its picture from source "${id}", but that source has no video track ` +
              `(an audio file, or only embedded cover art) — pick a video source, or use output:"audio"`,
          )
        }
        continue // no sound track → the render pads this segment with silence
      }
      if (t.state === "unmeasured") {
        skipped.push({ segment: seg.id, source: id, track, reason: t.reason })
        continue
      }
      const src = edl.sources.find((s) => s.id === id)
      const endSec = secs(seg.outMs - offsetOf(src))
      if (endSec > t.endSec + SOURCE_END_TOLERANCE_SEC) {
        throw new DeterministicJobError(
          `apply-edl: segment[${i}] "${seg.id}" ends at ${endSec.toFixed(2)}s on source "${id}", ` +
            `but its ${track} track is only ${t.endSec.toFixed(2)}s long — shorten the segment or check the source's offsetMs`,
        )
      }
    }
  })
  return skipped
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath,
    ])
    return out.trim().length > 0
  } catch {
    return false
  }
}

/** Proxy renders cap the picture at 720p (height), preserving aspect, even-rounded. */
function targetForQuality(
  picked: { width: number; height: number },
  quality: "proxy" | "final",
): { width: number; height: number } {
  if (quality !== "proxy" || picked.height <= 720) return even(picked)
  const scale = 720 / picked.height
  return even({ width: picked.width * scale, height: 720 })
}

const even = (d: { width: number; height: number }): { width: number; height: number } => ({
  width: Math.max(2, Math.round(d.width / 2) * 2),
  height: Math.max(2, Math.round(d.height / 2) * 2),
})

/**
 * Render ONE contiguous slice of segments (internal boundaries may be cut or
 * crossfade) into `outPath` via a single filter_complex. `sourcePaths` maps a
 * source id to its already-downloaded local file; `audioPresent` maps a source
 * id to whether that file carries an audio stream.
 */
async function renderSlice(
  edl: Edl,
  segs: readonly EdlSegment[],
  opts: {
    output: "video" | "audio"
    target: { width: number; height: number }
    fps: number
    masterAudioId: string | undefined
    sourcePaths: Map<string, string>
    audioPresent: Map<string, boolean>
    outPath: string
    workDir: string
  },
): Promise<void> {
  const { output, target, fps, masterAudioId, sourcePaths, audioPresent, outPath } = opts
  const wantVideo = output === "video"

  // Stable ffmpeg input list: every distinct source this slice touches, plus a
  // shared silent generator when some segment's audio source has no track.
  const inputIds: string[] = []
  const inputIndexOf = new Map<string, number>()
  const addInput = (id: string): number => {
    if (inputIndexOf.has(id)) return inputIndexOf.get(id)!
    const idx = inputIds.length
    inputIds.push(id)
    inputIndexOf.set(id, idx)
    return idx
  }

  interface SegPlan { readonly vLabel?: string; readonly aLabel: string }
  const filters: string[] = []
  const plans: SegPlan[] = []
  let needsSilence = false

  segs.forEach((seg, i) => {
    const durS = secs(seg.outMs - seg.inMs)

    // --- video --- (`:V` — a real video stream, never embedded cover art;
    // the same stream `probeStreamEnds` measured)
    let vLabel: string | undefined
    if (wantVideo) {
      const vs = edl.sources.find((s) => s.id === seg.video)!
      const vIdx = addInput(vs.id)
      const start = Math.max(0, secs(seg.inMs - offsetOf(vs)))
      const end = Math.max(start, secs(seg.outMs - offsetOf(vs)))
      vLabel = `[v${i}]`
      filters.push(
        `[${vIdx}:V]trim=start=${start.toFixed(6)}:end=${end.toFixed(6)},setpts=PTS-STARTPTS,` +
          `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
          `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${fps},format=yuv420p,setsar=1${vLabel}`,
      )
    }

    // --- audio ---
    const aId = audioSourceId(edl, seg, masterAudioId)
    const aSrc = aId ? edl.sources.find((s) => s.id === aId) : undefined
    const aLabel = `[a${i}]`
    if (aSrc && audioPresent.get(aSrc.id)) {
      const aIdx = addInput(aSrc.id)
      const aStart = Math.max(0, secs(seg.inMs - offsetOf(aSrc)))
      const aEnd = Math.max(aStart, secs(seg.outMs - offsetOf(aSrc)))
      filters.push(
        `[${aIdx}:a]atrim=start=${aStart.toFixed(6)}:end=${aEnd.toFixed(6)},asetpts=PTS-STARTPTS,` +
          `aformat=sample_rates=48000:channel_layouts=stereo${aLabel}`,
      )
    } else {
      // No usable audio track for this segment — synthesize silence of exactly
      // the segment's length so the audio timeline stays continuous.
      needsSilence = true
      filters.push(
        `[SILENCE]atrim=duration=${durS.toFixed(6)},asetpts=PTS-STARTPTS,` +
          `aformat=sample_rates=48000:channel_layouts=stereo${aLabel}`,
      )
    }

    plans.push({ vLabel, aLabel })
  })

  // Build the ffmpeg input args from the resolved id order.
  const inputArgs: string[] = []
  for (const id of inputIds) inputArgs.push("-i", sourcePaths.get(id)!)
  if (needsSilence) inputArgs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo")
  // Re-point the [SILENCE] placeholder at the real anullsrc input index.
  const graph = needsSilence
    ? filters.map((f) => f.replaceAll("[SILENCE]", `[${inputIds.length}:a]`)).join(";")
    : filters.join(";")

  // Pairwise join — offsets accumulate like combine-videos' buildVideoFilter.
  const durs = segs.map((s) => secs(s.outMs - s.inMs))
  const chainParts: string[] = []

  // audio chain (always present)
  let aAcc = plans[0].aLabel
  let runA = durs[0]
  for (let i = 1; i < segs.length; i++) {
    const D = boundaryOverlapSecs(segs[i], segs[i - 1])
    const out = i === segs.length - 1 ? "[aout]" : `[aAcc${i}]`
    if (D > 0) {
      chainParts.push(`${aAcc}${plans[i].aLabel}acrossfade=d=${D.toFixed(6)}${out}`)
      runA = Math.max(0, runA - D) + durs[i]
    } else {
      chainParts.push(`${aAcc}${plans[i].aLabel}concat=n=2:v=0:a=1${out}`)
      runA += durs[i]
    }
    aAcc = out
  }
  const audioOutLabel = segs.length === 1 ? plans[0].aLabel : "[aout]"

  // video chain (video output only)
  let videoOutLabel: string | undefined
  if (wantVideo) {
    let vAcc = plans[0].vLabel!
    let runV = durs[0]
    for (let i = 1; i < segs.length; i++) {
      const D = boundaryOverlapSecs(segs[i], segs[i - 1])
      const out = i === segs.length - 1 ? "[vout]" : `[vAcc${i}]`
      if (D > 0) {
        const off = Math.max(0, runV - D)
        chainParts.push(`${vAcc}${plans[i].vLabel!}xfade=transition=fade:duration=${D.toFixed(6)}:offset=${off.toFixed(6)}${out}`)
        runV = off + durs[i]
      } else {
        chainParts.push(`${vAcc}${plans[i].vLabel!}concat=n=2:v=1:a=0${out}`)
        runV += durs[i]
      }
      vAcc = out
    }
    videoOutLabel = segs.length === 1 ? plans[0].vLabel! : "[vout]"
  }

  const fullFilter = [graph, ...chainParts].filter(Boolean).join(";")

  const proxy = target.height <= 720
  const args: string[] = ["-y", ...inputArgs, "-filter_complex", fullFilter]
  if (wantVideo) {
    args.push(
      "-map", videoOutLabel!,
      "-map", audioOutLabel,
      "-c:v", "libx264",
      "-preset", proxy ? "veryfast" : "fast",
      "-crf", proxy ? "26" : COMBINE_DELIVERY_CRF,
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      outPath,
    )
  } else {
    args.push("-map", audioOutLabel, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", outPath)
  }

  // Explicit longer timeout: the default 10-min per-spawn would kill a long
  // chunk. The handler's liveness budget (`applyEdlRenderBudgetMs`) is summed
  // from this same per-chunk figure, so "hung" means one thing to both.
  await runFfmpeg(args, chunkRenderTimeoutMs(segs))
}

/** The chunk plan a render uses: ONE pass at or below the threshold, else
 *  slices closed at hard cuts. The render and its liveness budget both call
 *  this, so they cannot disagree about how many chunks there are. */
export function resolveChunks(
  segs: readonly EdlSegment[],
  options: Pick<ApplyEdlOptions, "maxSegmentsPerChunk" | "chunkThreshold"> = {},
): EdlSegment[][] {
  const maxPerChunk = options.maxSegmentsPerChunk ?? DEFAULT_MAX_SEGMENTS_PER_CHUNK
  const threshold = options.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  return segs.length > threshold ? planChunks(segs, maxPerChunk) : [segs as EdlSegment[]]
}

/** The output seconds one chunk renders (D17: crossfade overlaps subtracted). */
function chunkOutputSec(segs: readonly EdlSegment[]): number {
  return segs.reduce((acc, s, i) => acc + secs(s.outMs - s.inMs) - (i > 0 ? boundaryOverlapSecs(segs[i], segs[i - 1]) : 0), 0)
}

/** The ffmpeg kill budget `renderSlice` gives one chunk. */
export function chunkRenderTimeoutMs(segs: readonly EdlSegment[]): number {
  return Math.max(CHUNK_RENDER_TIMEOUT_FLOOR_MS, Math.ceil(chunkOutputSec(segs) * CHUNK_RENDER_SECS_PER_OUTPUT_SEC) * 1000)
}

/** Per referenced source, run in sequence before the first chunk: one fetch
 *  (`downloadFile`'s ceiling), then `hasAudioStream` (one ffprobe), then
 *  `probeStreamEnds` — its stream listing (one ffprobe) plus up to two per-track
 *  packet scans, each with the default ffmpeg watchdog. */
export const APPLY_EDL_PER_SOURCE_PREP_MS =
  DOWNLOAD_TIMEOUT_MS + 2 * FFPROBE_TIMEOUT_MS + 2 * DEFAULT_FFMPEG_TIMEOUT_MS

/** Once per VIDEO render, before the first chunk: the picture-canvas probes —
 *  resolution, then fps, each run across every video source in parallel, each
 *  at the ffprobe ceiling. An audio-only render skips them. */
export const APPLY_EDL_CANVAS_PROBE_MS = 2 * FFPROBE_TIMEOUT_MS

/** The sources `applyEdl` downloads for this output — the picture source of
 *  each segment for a video render, and each segment's sound source
 *  (`audioSourceId`) always. The one read set the render and its budget share. */
export function referencedSourceIds(edl: Edl, output: "video" | "audio"): Set<string> {
  const masterAudioId = edl.sources.find((s) => s.role === "master-audio")?.id
  const referenced = new Set<string>()
  for (const seg of edl.segments) {
    if (output === "video" && seg.video) referenced.add(seg.video)
    const aId = audioSourceId(edl, seg, masterAudioId)
    if (aId) referenced.add(aId)
  }
  return referenced
}

/**
 * The handler's liveness budget (`HandlerFn.livenessBudgetMs`): the sum of the
 * kill budgets of every BOUNDED step `applyEdl` runs for this EDL and output,
 * in the order it runs them — each referenced source's fetch + audio probe
 * (`referencedSourceIds`, the same read set the render uses), the canvas
 * probes (video only), every chunk's ffmpeg budget (`chunkRenderTimeoutMs`,
 * over `resolveChunks` — the same plan the render uses), and the final
 * stream-copy concat at the default ceiling when there is more than one chunk.
 * One number decides "hung" for the heartbeat and for those steps.
 *
 * NOT in the sum, because they have no ceiling of their own to add: time
 * WAITING for an ffmpeg slot, and storage I/O (the R2 client has no request
 * timeout — chunk checkpoints, the 404-fallback download, and the deliverable
 * upload after the render). Those ride in the slack between a real render and
 * its kill budgets, plus the 30 minutes after the last beat; see the wrapper
 * doc (`workers/pre-task-heartbeat.ts`).
 */
export function applyEdlRenderBudgetMs(
  edl: Edl,
  options: Pick<ApplyEdlOptions, "maxSegmentsPerChunk" | "chunkThreshold"> & { readonly output?: "video" | "audio" } = {},
): number {
  const output = options.output === "audio" ? "audio" : "video"
  const chunks = resolveChunks(edl.segments, options)
  const render = chunks.reduce((acc, chunk) => acc + chunkRenderTimeoutMs(chunk), 0)
  const prep = referencedSourceIds(edl, output).size * APPLY_EDL_PER_SOURCE_PREP_MS
    + (output === "video" ? APPLY_EDL_CANVAS_PROBE_MS : 0)
  const concat = chunks.length > 1 ? DEFAULT_FFMPEG_TIMEOUT_MS : 0
  return render + prep + concat
}

/** Split the timeline into contiguous slices closed ONLY at hard-cut boundaries
 *  (index i is a cut when segment i has no time-consuming transition). A run of
 *  xfaded segments stays whole even if it overshoots `maxPerChunk`. */
export function planChunks(segs: readonly EdlSegment[], maxPerChunk: number): EdlSegment[][] {
  const chunks: EdlSegment[][] = []
  let current: EdlSegment[] = []
  for (let i = 0; i < segs.length; i++) {
    const isCutBoundary = i > 0 && boundaryOverlapSecs(segs[i], segs[i - 1]) === 0
    if (isCutBoundary && current.length >= maxPerChunk) {
      chunks.push(current)
      current = []
    }
    current.push(segs[i])
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export async function applyEdl(options: ApplyEdlOptions): Promise<ApplyEdlResult> {
  const { edl, output, quality, jobId, jobUserId, onProgress, checkpoint = true } = options
  const wantVideo = output === "video"
  const workDir = await createWorkDir("apply-edl")
  const ext = wantVideo ? "mp4" : "m4a"

  try {
    // Which sources do we actually touch? Download each ONCE.
    const masterAudio = edl.sources.find((s) => s.role === "master-audio")
    const masterAudioId = masterAudio?.id
    const referenced = referencedSourceIds(edl, output)

    const sourcePaths = new Map<string, string>()
    const audioPresent = new Map<string, boolean>()
    const sourceEnds = new Map<string, StreamEnds>()
    let dl = 0
    for (const id of referenced) {
      const src = edl.sources.find((s) => s.id === id)
      if (!src) throw new Error(`apply-edl: segment references unknown source "${id}"`)
      const localPath = join(workDir, `src-${sourcePaths.size}.${src.kind === "audio" ? "m4a" : "mp4"}`)
      await downloadFile(src.url, localPath)
      sourcePaths.set(id, localPath)
      audioPresent.set(id, await hasAudioStream(localPath))
      // The one per-source measurement that lets the window check below be
      // honest: each track's REAL end, from its own packets, on the render's
      // clock — not the container's declared duration (a Xing-less VBR mp3
      // under-reports it; a live-muxed MediaRecorder WebM omits it; both
      // render fine), and not one blended number for a file whose picture and
      // sound differ in length. A file this cannot read at all stays
      // unmeasured: the check skips it (logged) and the render proceeds as it
      // always has, rather than failing a paid job over a probe.
      try {
        sourceEnds.set(id, await probeStreamEnds(localPath))
      } catch (err) {
        console.warn(
          `[apply-edl] source "${id}": could not measure its tracks, the window check skips it (${err instanceof Error ? err.message : String(err)})`,
        )
      }
      dl++
      onProgress?.(0.05 + 0.15 * (dl / referenced.size))
    }

    // Every segment must exist on the media it reads. Ingress already refused a
    // segment that starts before its source's origin; only the file itself can
    // say whether one runs PAST the end of the track it reads — so it is
    // checked here, once the sources are local, per track, and the job FAILS
    // naming the segment (a DeterministicJobError: failed + refunded now, not
    // retried — the same inputs fail the same way). It never clamps: a silently
    // shortened segment would deliver a shorter render than the EDL (and than
    // the reserve and the caption remap) describes, with no error anywhere.
    // Overshoot inside SOURCE_END_TOLERANCE_SEC is rounding — a transcript's
    // last word can end a beat after the audio — and renders to whatever the
    // track has.
    const skipped = assertSegmentsWithinSources(edl, masterAudioId, wantVideo, sourceEnds)
    for (const s of skipped) {
      console.warn(
        `[apply-edl] segment "${s.segment}" reads the ${s.track} track of source "${s.source}", which could not be measured — the window check skips it (${s.reason})`,
      )
    }

    // Picture canvas (video output only): majority resolution / fps of the
    // referenced VIDEO sources, then proxy-capped.
    let target = { width: 1280, height: 720 }
    let fps = 30
    if (wantVideo) {
      const videoPaths = [...referenced]
        .map((id) => edl.sources.find((s) => s.id === id))
        .filter((s): s is EdlSource => !!s && s.kind === "video")
        .map((s) => sourcePaths.get(s.id)!)
      const picked = videoPaths.length > 0 ? await pickTargetResolution(videoPaths) : { width: 1280, height: 720 }
      target = targetForQuality(picked, quality)
      fps = videoPaths.length > 0 ? await pickTargetFps(videoPaths) : 30
    }

    const chunks = resolveChunks(edl.segments, options)

    const chunkPaths: string[] = []
    const checkpointKeys: string[] = []
    for (let c = 0; c < chunks.length; c++) {
      const chunkPath = join(workDir, `chunk-${c}.${ext}`)
      const key = `apply-edl-cache/${jobId}/chunk-${c}.${ext}`

      // Resume: a chunk already checkpointed to R2 (a prior worker attempt) is
      // pulled back instead of re-rendered. Storage is dynamically imported so
      // the module graph (and unit tests) never pull the R2 client unless a
      // real multi-chunk render needs it.
      const useCheckpoint = checkpoint && chunks.length > 1
      let resumed = false
      if (useCheckpoint) {
        try {
          const { getR2ObjectSize, downloadR2ObjectToFile } = await import("../../lib/storage.js")
          if ((await getR2ObjectSize(key)) > 0) {
            await downloadR2ObjectToFile(key, chunkPath)
            resumed = true
          }
        } catch {
          /* checkpoint miss — render below */
        }
      }

      if (!resumed) {
        await renderSlice(edl, chunks[c], {
          output, target, fps, masterAudioId, sourcePaths, audioPresent, outPath: chunkPath, workDir,
        })
        if (useCheckpoint) {
          try {
            const { uploadFileWithKeyToR2 } = await import("../../lib/storage.js")
            // No trackUserId: this is internal render scratch, not a
            // deliverable, so it must never count against the user's quota.
            await uploadFileWithKeyToR2(chunkPath, key, wantVideo ? "video/mp4" : "audio/mp4", undefined)
          } catch {
            /* checkpoint upload best-effort — a restart just re-renders */
          }
        }
      }
      if (useCheckpoint) checkpointKeys.push(key)
      chunkPaths.push(chunkPath)
      onProgress?.(0.2 + 0.7 * ((c + 1) / chunks.length))
    }

    // Single chunk → it IS the output. Multiple chunks (all joined at hard
    // cuts) → concat-demuxer stream-copy.
    let outputPath: string
    if (chunkPaths.length === 1) {
      outputPath = chunkPaths[0]
    } else {
      outputPath = join(workDir, `output.${ext}`)
      const listPath = join(workDir, "chunks.txt")
      await fs.writeFile(listPath, chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"))
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath])
      // The concat succeeded — the checkpoint cache has done its job (resume on
      // restart). Best-effort delete it so the internal scratch doesn't linger.
      if (checkpointKeys.length > 0) {
        try {
          const { deleteFromR2 } = await import("../../lib/storage.js")
          await Promise.allSettled(checkpointKeys.map((k) => deleteFromR2(k)))
        } catch {
          /* cache cleanup is best-effort — a lifecycle rule / next run is the backstop */
        }
      }
    }

    onProgress?.(1)
    return { outputPath, durationMs: edlDurationMs(edl) }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
