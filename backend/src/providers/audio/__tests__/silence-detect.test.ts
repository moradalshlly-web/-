/**
 * Silence Detect provider tests.
 *
 *  - `parseSilenceRanges` is pure (no ffmpeg): fixture stderr in, padded
 *    source-clock ranges out — the padding/clamp/dangling-close logic.
 *  - `runSilenceDetectOnFile` is a real-ffmpeg e2e (same lavfi fixture idiom as
 *    trim-edge-frames.e2e.test.ts): a 6 s tone muted between t=2..4 must recover
 *    exactly one silence range near [2 s, 4 s], shrunk inward by the pad.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg } from "../../video/ffmpeg-utils.js"
import { parseSilenceRanges, runSilenceDetectOnFile } from "../silence-detect.js"

describe("parseSilenceRanges", () => {
  it("pairs start/end markers and shrinks each range inward by padMs", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 2.000",
      "[silencedetect @ 0x1] silence_end: 4.000 | silence_duration: 2.000",
    ].join("\n")
    const ranges = parseSilenceRanges(stderr, { padMs: 120, durationMs: 6000 })
    expect(ranges).toEqual([{ startMs: 2120, endMs: 3880 }])
  })

  it("applies zero padding verbatim", () => {
    const stderr = "silence_start: 1.5\nsilence_end: 3.25 | silence_duration: 1.75"
    const ranges = parseSilenceRanges(stderr, { padMs: 0, durationMs: 10_000 })
    expect(ranges).toEqual([{ startMs: 1500, endMs: 3250 }])
  })

  it("drops a range that collapses once the pad is applied on both sides", () => {
    // 300 ms silence, 200 ms pad each side → 300 - 400 < 0 → dropped.
    const stderr = "silence_start: 5.0\nsilence_end: 5.3 | silence_duration: 0.3"
    const ranges = parseSilenceRanges(stderr, { padMs: 200, durationMs: 10_000 })
    expect(ranges).toEqual([])
  })

  it("closes a dangling silence_start at the duration (source ends mid-silence)", () => {
    const stderr = "silence_start: 8.0"
    const ranges = parseSilenceRanges(stderr, { padMs: 0, durationMs: 10_000 })
    expect(ranges).toEqual([{ startMs: 8000, endMs: 10_000 }])
  })

  it("clamps a negative silence_start to zero", () => {
    const stderr = "silence_start: -0.002\nsilence_end: 1.0 | silence_duration: 1.0"
    const ranges = parseSilenceRanges(stderr, { padMs: 0, durationMs: 5000 })
    expect(ranges).toEqual([{ startMs: 0, endMs: 1000 }])
  })

  it("recovers multiple ranges in order", () => {
    const stderr = [
      "silence_start: 1.0",
      "silence_end: 2.0 | silence_duration: 1.0",
      "silence_start: 5.0",
      "silence_end: 7.0 | silence_duration: 2.0",
    ].join("\n")
    const ranges = parseSilenceRanges(stderr, { padMs: 0, durationMs: 10_000 })
    expect(ranges).toEqual([
      { startMs: 1000, endMs: 2000 },
      { startMs: 5000, endMs: 7000 },
    ])
  })
})

describe("runSilenceDetectOnFile (e2e, real ffmpeg)", () => {
  let dir: string
  beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "silence-detect-e2e-")) })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  // A 6 s 440 Hz tone, muted (volume=0) for t in [2, 4] → a 2 s silent gap.
  async function makeToneWithGap(path: string): Promise<void> {
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-af", "volume=enable='between(t,2,4)':volume=0",
      path,
    ])
  }

  it("recovers a single silence range near [2s, 4s], padded inward", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await makeToneWithGap(src)

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 700, padMs: 120 })

    expect(result.version).toBe(1)
    // ~6 s duration.
    expect(Math.abs(result.durationMs - 6000)).toBeLessThan(250)
    // Exactly one silence span.
    expect(result.ranges).toHaveLength(1)
    const r = result.ranges[0]!
    // Raw silence ~[2000, 4000]; padMs 120 shrinks each end. Generous tolerance
    // for silencedetect's RMS-window latency.
    expect(r.startMs).toBeGreaterThan(1950)
    expect(r.startMs).toBeLessThan(2400)
    expect(r.endMs).toBeGreaterThan(3600)
    expect(r.endMs).toBeLessThan(3950)
    expect(r.endMs).toBeGreaterThan(r.startMs)
  }, 60_000)

  it("reports no silence in a continuous tone", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", src])

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 700, padMs: 120 })
    expect(result.ranges).toHaveLength(0)
    expect(Math.abs(result.durationMs - 4000)).toBeLessThan(250)
  }, 60_000)
})
