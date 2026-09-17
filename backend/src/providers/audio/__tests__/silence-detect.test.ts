/**
 * Silence Detect — pure parse/pad unit tests (no ffmpeg).
 *
 * `parseSilenceRanges` maps fixture `silencedetect` stderr into padded
 * source-clock ranges: pairing, inward padding, clamp, collapse-drop, and the
 * dangling-start (source ends mid-silence) close. The real-ffmpeg pass is
 * exercised separately in silence-detect.e2e.test.ts.
 */
import { describe, it, expect } from "vitest"
import { parseSilenceRanges } from "../silence-detect.js"

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
