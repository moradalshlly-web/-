// `buildSliceCommand` is pure: it decides EVERYTHING a slice renders (filter
// graph, encode arguments, input order) without touching the filesystem, so a
// chunk's resume key can be a hash of exactly that (`sliceFingerprint`). These
// pin the two properties the resume path depends on — the key moves whenever
// the render would, and never because of per-run local paths — and the
// crossfade chunk's end-of-chunk hold to the frame grid (Track 0.14).
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { buildSliceCommand, sliceFingerprint, INPUT_SEEK_MARGIN_SEC, type SliceOptions } from "../apply-edl.js"

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "A", url: "https://f.test/camA.mp4", kind: "video" },
    { id: "B", url: "https://f.test/camB.mp4", kind: "video" },
    { id: "MIC", url: "https://f.test/master.m4a", kind: "audio", role: "master-audio" },
  ],
  segments: Array.from({ length: 6 }, (_, k) => ({
    id: `s${k}`, inMs: k * 617, outMs: (k + 1) * 617, video: k % 2 === 0 ? "A" : "B",
  })),
} as unknown as Edl

const OPTS: SliceOptions = {
  output: "video",
  target: { width: 320, height: 240 },
  fps: 30,
  chunkStartSec: 0,
  masterAudioId: "MIC",
  audioPresent: new Map([["A", true], ["B", true], ["MIC", true]]),
}

const cmd = (over: Partial<SliceOptions> = {}, segs: readonly EdlSegment[] = EDL.segments, edl: Edl = EDL) =>
  buildSliceCommand(edl, segs, { ...OPTS, ...over })

describe("buildSliceCommand — a pure description of the render", () => {
  it("names sources by id, never by a local path, and leaves the output path to the runner", () => {
    const c = cmd()
    expect(c.inputIds).toEqual(["A", "MIC", "B"])
    expect(c.filterGraph).not.toMatch(/\.mp4|\.m4a|\.wav|\/tmp|\/var/)
    expect(c.outputArgs.join(" ")).not.toMatch(/\.mp4|\.m4a|\.wav/)
  })

  it("a video-only chunk maps no audio and says so (-an)", () => {
    const c = cmd({ omitAudio: true })
    expect(c.outputArgs).toContain("-an")
    expect(c.outputArgs.join(" ")).not.toContain("-c:a")
    expect(c.inputIds).toEqual(["A", "B"]) // the master is not an input
  })

  it("an audio slice for option B's pass is lossless PCM in RF64", () => {
    const c = cmd({ output: "audio", audioCodec: "pcm" })
    expect(c.outputArgs.join(" ")).toContain("-c:a pcm_f32le")
    expect(c.outputArgs.join(" ")).toContain("-rf64 auto")
  })
})

describe("sliceFingerprint — the resume key IS the command", () => {
  const V = "ffmpeg version n8.1.2"
  const fp = (c = cmd(), edl: Edl = EDL, v = V) => sliceFingerprint(c, edl, v)

  it("is stable for the same render (so a retry on a fresh workDir resumes)", () => {
    expect(fp(cmd())).toBe(fp(cmd()))
  })

  it("moves when the chunk's grid position changes its frame counts", () => {
    // 0.02 s later flips the first cut from 19 to 18 frames.
    expect(fp(cmd({ chunkStartSec: 0.02 }))).not.toBe(fp(cmd({ chunkStartSec: 0 })))
  })

  it("is SHARED by two positions that render byte-identically — the key is content, not bookkeeping", () => {
    // 0.5 s later happens to give every 0.617 s cut the same frame count, so the
    // command — and the output — is identical, and reusing it is correct.
    expect(cmd({ chunkStartSec: 0.5 }).filterGraph).toBe(cmd({ chunkStartSec: 0 }).filterGraph)
    expect(fp(cmd({ chunkStartSec: 0.5 }))).toBe(fp(cmd({ chunkStartSec: 0 })))
  })

  it("moves when the chunk covers different segments (a re-planned chunk)", () => {
    expect(fp(cmd({}, EDL.segments.slice(0, 3)))).not.toBe(fp(cmd({}, EDL.segments.slice(0, 4))))
  })

  it("moves when the chunk stops carrying audio (the option-B change itself)", () => {
    expect(fp(cmd({ omitAudio: true }))).not.toBe(fp(cmd({ omitAudio: false })))
  })

  it("moves with the canvas, the fps, the ffmpeg build and a source URL", () => {
    const base = fp()
    expect(fp(cmd({ target: { width: 640, height: 480 } }))).not.toBe(base)
    expect(fp(cmd({ fps: 25 }))).not.toBe(base)
    expect(fp(cmd(), EDL, "ffmpeg version n9.0")).not.toBe(base)
    const moved = { ...EDL, sources: EDL.sources.map((s) => (s.id === "A" ? { ...s, url: "https://f.test/other.mp4" } : s)) } as Edl
    expect(fp(cmd({}, EDL.segments, moved), moved)).not.toBe(base)
  })
})

describe("every chunk is held to its grid frame count at its END", () => {
  // 3 × 1 s segments, a 300 ms crossfade INTO the 2nd → 2.7 s of output.
  const segs = [
    { id: "x0", inMs: 0, outMs: 1000, video: "A" },
    { id: "x1", inMs: 1000, outMs: 2000, video: "B", transition: { type: "crossfade", durationMs: 300 } },
    { id: "x2", inMs: 2000, outMs: 3000, video: "A" },
  ] as unknown as EdlSegment[]
  const HOLD = (n: number) => `tpad=stop_mode=clone:stop=-1,trim=start_frame=0:end_frame=${n},setpts=N/FRAME_RATE/TB[vout]`

  it("a crossfade chunk keeps exactly round((start+out)·F) − round(start·F) frames", () => {
    const c = cmd({ chunkStartSec: 10 }, segs)
    expect(c.filterGraph).toContain(`[vxf]${HOLD(Math.round((10 + 2.7) * 30) - Math.round(10 * 30))}`) // 81
  })

  it("a cut chunk ends with the same hold, sized to Σ of its segments' grid frames", () => {
    // six 617 ms cuts from 0: 19+18+19+18+19+18 = 111 = round(3.702·30)
    expect(cmd().filterGraph).toContain(`${HOLD(111)}`)
  })

  it("every picture read is taken from its source held past the end, every sound read from one padded with silence", () => {
    const g = cmd().filterGraph
    expect(g.match(/:V\]tpad=stop_mode=clone:stop=-1,trim=/g)).toHaveLength(6)
    expect(g.match(/:a\]apad,atrim=/g)).toHaveLength(6)
  })
})

describe("input seek — each source is read from its earliest window, not from t=0", () => {
  // The same six cuts, 100 s into every source.
  const late = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 100_000, outMs: s.outMs + 100_000 }))

  it("seeks each input to its earliest read minus the margin and rebases every trim on it", () => {
    const c = cmd({}, late)
    expect(c.inputSeekSec).toEqual([100 - INPUT_SEEK_MARGIN_SEC, 100 - INPUT_SEEK_MARGIN_SEC, 100.617 - INPUT_SEEK_MARGIN_SEC])
    expect(c.filterGraph).toContain(`[0:V]tpad=stop_mode=clone:stop=-1,trim=start=${INPUT_SEEK_MARGIN_SEC.toFixed(6)}:`)
    expect(c.filterGraph).toContain(`[1:a]apad,atrim=start=${INPUT_SEEK_MARGIN_SEC.toFixed(6)}:`)
  })

  it("does not seek a window within the margin of the source start", () => {
    expect(cmd().inputSeekSec).toEqual([0, 0, 0])
  })

  it("the key hashes the seek: two windows whose rebased graphs are identical still get different keys", () => {
    const at200 = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 200_000, outMs: s.outMs + 200_000 }))
    const a = cmd({}, late)
    const b = cmd({}, at200)
    expect(a.filterGraph).toBe(b.filterGraph)
    expect(sliceFingerprint(a, EDL, "v")).not.toBe(sliceFingerprint(b, EDL, "v"))
  })
})
