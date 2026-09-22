// apply-edl's liveness budget IS its ffmpeg kill budget. The video worker's
// pre-task heartbeat stops beating at a cap so a hung handler ages into the
// reconcile sweep; the DEFAULT cap (the orchestrator's 90-min node ceiling)
// is far shorter than a legitimate final-quality render of a long episode on a
// direct lane, and a cap sized by guesswork ("~2× real time") was a second
// hung-detector that disagreed with the renderer's own (6× output per chunk).
// So the handler declares `applyEdlRenderBudgetMs(edl)` — the sum of the kill
// budgets of its BOUNDED steps, the per-chunk figure being the SAME one
// `renderSlice` hands `runFfmpeg` over the SAME chunk plan (`resolveChunks`).
// Storage I/O and ffmpeg-slot waits have no ceiling to add; they are the
// stated residual, not part of this sum.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import {
  applyEdlRenderBudgetMs,
  chunkRenderTimeoutMs,
  planChunks,
  resolveChunks,
  APPLY_EDL_CANVAS_PROBE_MS,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_TIMEOUT_FLOOR_MS,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_MAX_SEGMENTS_PER_CHUNK,
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

/** The chunk plan spelled out independently of `resolveChunks`, so a change to
 *  either the thresholds or the resolver shows up as a disagreement here. */
function chunksOf(edl: Edl): EdlSegment[][] {
  return edl.segments.length > DEFAULT_CHUNK_THRESHOLD
    ? planChunks(edl.segments, DEFAULT_MAX_SEGMENTS_PER_CHUNK)
    : [edl.segments as EdlSegment[]]
}

describe("resolveChunks — the one chunk plan the render and its budget share", () => {
  it.each([1, 200, 201, 1000])("matches the threshold rule for a %i-segment edit", (n) => {
    expect(resolveChunks(cuts(n, 60).segments)).toEqual(chunksOf(cuts(n, 60)))
  })
})

describe("the prep terms are the ceilings of the steps they name", () => {
  it("per source: one fetch + the audio-stream probe; once per render: the resolution and fps probes", () => {
    expect(APPLY_EDL_PER_SOURCE_PREP_MS).toBe(DOWNLOAD_TIMEOUT_MS + FFPROBE_TIMEOUT_MS)
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
    const chunks = chunksOf(edl)
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(c), 0)
    expect(applyEdlRenderBudgetMs(edl)).toBeGreaterThanOrEqual(renderBudget)
    // and it is exactly the bounded steps' ceilings — render + per-source prep +
    // canvas probes + (concat when chunked) — no slack invented
    const concat = chunks.length > 1 ? DEFAULT_FFMPEG_TIMEOUT_MS : 0
    expect(applyEdlRenderBudgetMs(edl)).toBe(renderBudget + APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS + concat)
  })

  it("counts prep once per referenced source, including the master-audio source no segment names", () => {
    const one = cuts(1, 60)
    const withMic: Edl = {
      ...one,
      sources: [...one.sources, { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" }],
    } as Edl
    expect(applyEdlRenderBudgetMs(withMic) - applyEdlRenderBudgetMs(one)).toBe(APPLY_EDL_PER_SOURCE_PREP_MS)
  })

  it("outlives the orchestrator's 90-minute node ceiling for a long final render — the case the default cap could not cover", () => {
    // A 3-hour episode cut into 180 one-minute segments (one chunk): 6× output.
    const threeHours = cuts(180, 60)
    expect(applyEdlRenderBudgetMs(threeHours)).toBeGreaterThan(18 * 60 * MIN)
  })

  it("is monotone in output length", () => {
    expect(applyEdlRenderBudgetMs(cuts(90, 60))).toBeLessThan(applyEdlRenderBudgetMs(cuts(120, 60)))
  })
})
