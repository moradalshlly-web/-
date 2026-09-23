// apply-edl's liveness budget is built from the kill budgets of its own
// bounded steps. The video worker's
// pre-task heartbeat stops beating at a cap so a hung handler ages into the
// reconcile sweep; the DEFAULT cap (the orchestrator's 90-min node ceiling)
// is far shorter than a legitimate final-quality render of a long episode on a
// direct lane, and a cap sized by guesswork ("~2× real time") was a second
// hung-detector that disagreed with the renderer's own (6× output per chunk).
// So the handler declares `applyEdlRenderBudgetMs(edl)` — the sum of the kill
// budgets of its BOUNDED steps, the per-chunk figure being the SAME one
// `renderSlice` hands `runFfmpeg` over the SAME chunk plan
// (`resolveChunksForOutput` — a video render caps graph width at
// `VIDEO_FILTERGRAPH_MAX_SEGMENTS` and, when that makes it multi-chunk, adds one
// continuous audio pass + mux). Storage I/O and ffmpeg-slot waits have no
// ceiling to add; they are the stated residual, not part of this sum.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import {
  applyEdlRenderBudgetMs,
  audioMuxTimeoutMs,
  chunkRenderTimeoutMs,
  planChunks,
  referencedSourceIds,
  resolveChunks,
  resolveChunksForOutput,
  APPLY_EDL_CANVAS_PROBE_MS,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_TIMEOUT_FLOOR_MS,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_MAX_SEGMENTS_PER_CHUNK,
  VIDEO_FILTERGRAPH_MAX_SEGMENTS,
  AUDIO_MUX_SECS_PER_OUTPUT_SEC,
} from "../apply-edl.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS } from "../ffmpeg-utils.js"

const MIN = 60_000

/** `n` hard-cut segments of `segSec` seconds each, all on source A. */
function cuts(n: number, segSec: number): Edl {
  const segments: EdlSegment[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * segSec * 1000, outMs: (i + 1) * segSec * 1000, video: "A",
  }))
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

/** The chunk plan spelled out independently of `resolveChunksForOutput`, so a
 *  change to the thresholds, the VIDEO width cap, or the resolver shows up as a
 *  disagreement here. A video render caps every graph at
 *  `VIDEO_FILTERGRAPH_MAX_SEGMENTS`; audio is uncapped. */
function chunksOf(edl: Edl, output: "video" | "audio" = "video"): EdlSegment[][] {
  const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : Infinity
  const threshold = Math.min(DEFAULT_CHUNK_THRESHOLD, cap)
  const maxPer = Math.min(DEFAULT_MAX_SEGMENTS_PER_CHUNK, cap)
  return edl.segments.length > threshold
    ? planChunks(edl.segments, maxPer)
    : [edl.segments as EdlSegment[]]
}

describe("resolveChunks — the raw threshold rule (uncapped)", () => {
  it.each([1, 200, 201, 1000])("matches the threshold rule for a %i-segment edit", (n) => {
    expect(resolveChunks(cuts(n, 60).segments)).toEqual(
      cuts(n, 60).segments.length > DEFAULT_CHUNK_THRESHOLD
        ? planChunks(cuts(n, 60).segments, DEFAULT_MAX_SEGMENTS_PER_CHUNK)
        : [cuts(n, 60).segments],
    )
  })
})

describe("resolveChunksForOutput — video caps the graph width, audio does not", () => {
  it.each([1, 30, 31, 250, 1000])("a video render matches the capped plan for a %i-segment edit", (n) => {
    expect(resolveChunksForOutput(cuts(n, 1).segments, "video")).toEqual(chunksOf(cuts(n, 1), "video"))
  })
  it("no video graph exceeds VIDEO_FILTERGRAPH_MAX_SEGMENTS", () => {
    for (const c of resolveChunksForOutput(cuts(250, 1).segments, "video")) {
      expect(c.length).toBeLessThanOrEqual(VIDEO_FILTERGRAPH_MAX_SEGMENTS)
    }
  })
  it("an audio render is uncapped — same plan as resolveChunks", () => {
    expect(resolveChunksForOutput(cuts(250, 1).segments, "audio")).toEqual(resolveChunks(cuts(250, 1).segments))
  })
  it("an explicit smaller maxSegmentsPerChunk still wins over the cap", () => {
    for (const c of resolveChunksForOutput(cuts(90, 1).segments, "video", { maxSegmentsPerChunk: 10, chunkThreshold: 1 })) {
      expect(c.length).toBeLessThanOrEqual(10)
    }
  })
})

describe("the prep terms are the ceilings of the steps they name", () => {
  it("per source: one fetch + the audio-stream probe + probeStreamEnds (listing + 2 packet scans); once per render: the resolution and fps probes", () => {
    expect(APPLY_EDL_PER_SOURCE_PREP_MS).toBe(DOWNLOAD_TIMEOUT_MS + 2 * FFPROBE_TIMEOUT_MS + 2 * DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(APPLY_EDL_CANVAS_PROBE_MS).toBe(2 * FFPROBE_TIMEOUT_MS)
  })
})

describe("chunkRenderTimeoutMs — the kill budget one chunk gets", () => {
  it("scales with the chunk's output seconds at the declared factor, with the declared floor", () => {
    expect(chunkRenderTimeoutMs(cuts(1, 60).segments)).toBe(CHUNK_RENDER_TIMEOUT_FLOOR_MS) // 6 min < floor
    const hour = cuts(60, 60).segments // 3600 s of output
    expect(chunkRenderTimeoutMs(hour)).toBe(3600 * CHUNK_RENDER_SECS_PER_OUTPUT_SEC * 1000)
  })

  it("subtracts crossfade overlaps (D17): the chunk renders less than the sum of its segments", () => {
    const segs = cuts(2, 60).segments.map((s, i) =>
      i === 1 ? { ...s, transition: { type: "crossfade" as const, durationMs: 4000 } } : s,
    ) as EdlSegment[]
    // 120 s of segments, 4 s overlap → 116 s of output, still under the floor here
    expect(chunkRenderTimeoutMs(segs)).toBe(CHUNK_RENDER_TIMEOUT_FLOOR_MS)
    const long = cuts(40, 60).segments.map((s, i) =>
      i > 0 ? { ...s, transition: { type: "crossfade" as const, durationMs: 4000 } } : s,
    ) as EdlSegment[]
    expect(chunkRenderTimeoutMs(long)).toBeLessThan(chunkRenderTimeoutMs(cuts(40, 60).segments))
  })
})

describe("applyEdlRenderBudgetMs — the handler's liveness budget", () => {
  it.each([1, 250, 1000])("covers every chunk's kill budget for a %i-segment edit (the SAME chunk plan the render uses)", (n) => {
    const edl = cuts(n, 60)
    const chunks = chunksOf(edl, "video")
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(c), 0)
    expect(applyEdlRenderBudgetMs(edl)).toBeGreaterThanOrEqual(renderBudget)
    // and it is exactly the bounded steps' ceilings — render + per-source prep +
    // canvas probes + (when chunked: the ffmpeg-build probe + the concat, and
    // for video every audio slice of the AUDIO plan + the one join/encode/mux)
    // — no slack invented.
    const chunked = chunks.length > 1 ? 2 * DEFAULT_FFMPEG_TIMEOUT_MS : 0
    const audioSlices = chunksOf(edl, "audio").reduce((acc, c) => acc + chunkRenderTimeoutMs(c), 0)
    const audioMux = chunks.length > 1 ? audioSlices + audioMuxTimeoutMs(n * 60) : 0
    expect(applyEdlRenderBudgetMs(edl)).toBe(renderBudget + APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS + chunked + audioMux)
  })

  // An AUDIO render chunks on the uncapped plan and never runs option B's
  // separate audio pass — its chunks ARE the audio. (Dropping the
  // `output === "video"` guard would add a phantom audio pass to every long
  // audio render's budget; this pins it.)
  it.each([1, 250, 1000])("an audio-output render of %i segments counts its own chunks and no audio-mux step", (n) => {
    const edl = cuts(n, 60)
    const chunks = chunksOf(edl, "audio")
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(c), 0)
    const chunked = chunks.length > 1 ? 2 * DEFAULT_FFMPEG_TIMEOUT_MS : 0
    const prep = referencedSourceIds(edl, "audio").size * APPLY_EDL_PER_SOURCE_PREP_MS
    expect(applyEdlRenderBudgetMs(edl, { output: "audio" })).toBe(renderBudget + prep + chunked)
  })

  it("the join/encode/mux step's ceiling scales with the output, floored at the default", () => {
    expect(audioMuxTimeoutMs(30)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(audioMuxTimeoutMs(3 * 3600)).toBe(3 * 3600 * AUDIO_MUX_SECS_PER_OUTPUT_SEC * 1000)
  })

  it("counts prep once per referenced source, including the master-audio source no segment names", () => {
    const one = cuts(1, 60)
    const withMic: Edl = {
      ...one,
      sources: [...one.sources, { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" }],
    } as Edl
    expect(applyEdlRenderBudgetMs(withMic) - applyEdlRenderBudgetMs(one)).toBe(APPLY_EDL_PER_SOURCE_PREP_MS)
  })

  // The read set is the render's own (`referencedSourceIds`): an audio-only cut
  // never downloads the picture sources and never runs the canvas probes.
  it("an audio-only render counts only the sound sources and no canvas probes — exactly what applyEdl runs", () => {
    const one = cuts(1, 60)
    const withMic: Edl = {
      ...one,
      sources: [...one.sources, { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" }],
    } as Edl
    const render = chunkRenderTimeoutMs(withMic.segments)
    expect(referencedSourceIds(withMic, "video")).toEqual(new Set(["A", "MIC"]))
    expect(referencedSourceIds(withMic, "audio")).toEqual(new Set(["MIC"]))
    expect(applyEdlRenderBudgetMs(withMic, { output: "video" })).toBe(render + 2 * APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS)
    expect(applyEdlRenderBudgetMs(withMic, { output: "audio" })).toBe(render + APPLY_EDL_PER_SOURCE_PREP_MS)
  })

  it("outlives the orchestrator's 90-minute node ceiling for a long final render — the case the default cap could not cover", () => {
    // A 3-hour episode cut into 180 one-minute segments — a video render now
    // chunks it at the width cap (6 graphs of 30) + one audio pass: 6× output.
    const threeHours = cuts(180, 60)
    expect(applyEdlRenderBudgetMs(threeHours)).toBeGreaterThan(18 * 60 * MIN)
  })

  it("is monotone in output length", () => {
    expect(applyEdlRenderBudgetMs(cuts(90, 60))).toBeLessThan(applyEdlRenderBudgetMs(cuts(120, 60)))
  })
})
