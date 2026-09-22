// apply-edl's liveness budget IS its ffmpeg kill budget. The video worker's
// pre-task heartbeat stops beating at a cap so a hung handler ages into the
// reconcile sweep; the DEFAULT cap (the orchestrator's 90-min node ceiling)
// is far shorter than a legitimate final-quality render of a long episode on a
// direct lane, and a cap sized by guesswork ("~2× real time") was a second
// hung-detector that disagreed with the renderer's own (6× output per chunk).
// So the handler declares `applyEdlRenderBudgetMs(edl)` — composed from the
// SAME per-chunk timeout `renderSlice` hands `runFfmpeg` — and a render can
// only be failed by its own timeouts, never by the sweep while it still works.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import {
  applyEdlRenderBudgetMs,
  chunkRenderTimeoutMs,
  planChunks,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_TIMEOUT_FLOOR_MS,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_MAX_SEGMENTS_PER_CHUNK,
} from "../apply-edl.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../ffmpeg-utils.js"

const MIN = 60_000

/** `n` hard-cut segments of `segSec` seconds each, all on source A. */
function cuts(n: number, segSec: number): Edl {
  const segments: EdlSegment[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * segSec * 1000, outMs: (i + 1) * segSec * 1000, video: "A",
  }))
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

/** What `applyEdl` renders: the same chunk plan `applyEdlRenderBudgetMs` sums over. */
function chunksOf(edl: Edl): EdlSegment[][] {
  return edl.segments.length > DEFAULT_CHUNK_THRESHOLD
    ? planChunks(edl.segments, DEFAULT_MAX_SEGMENTS_PER_CHUNK)
    : [edl.segments as EdlSegment[]]
}

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
    // and it is exactly render + prep + (concat when chunked), no slack invented
    const concat = chunks.length > 1 ? DEFAULT_FFMPEG_TIMEOUT_MS : 0
    expect(applyEdlRenderBudgetMs(edl)).toBe(renderBudget + APPLY_EDL_PER_SOURCE_PREP_MS + concat)
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
