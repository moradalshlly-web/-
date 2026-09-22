// A segment must exist on the media it reads. Ingress refuses a segment that
// starts before its source's origin; only the downloaded file can say whether
// one runs PAST the end of the track it reads, so the executor checks that
// after download — per TRACK (the picture source's video track for a video
// render, the sound source's audio track always; a file whose tracks differ in
// length is two lengths, not one) — and FAILS naming the segment, the source
// and the track, never clamps. (A silently shortened segment is a shorter
// render than the EDL, the reserve and the caption remap describe, with no
// error anywhere.) Pure rule, measured ends injected: no ffprobe here.
import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared"
import { assertSegmentsWithinSources, SOURCE_END_TOLERANCE_SEC } from "../apply-edl.js"
import type { StreamEnds } from "../ffmpeg-utils.js"

const A = { id: "A", url: "https://f.test/a.mp4", kind: "video" as const }
const B = { id: "B", url: "https://f.test/b.mp4", kind: "video" as const }
const MIC = { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio" as const, role: "master-audio" as const }

const edl = (sources: Edl["sources"], segments: Array<Record<string, unknown>>): Edl =>
  ({ version: 1, clock: "master", sources, segments }) as unknown as Edl
/** `{ A: 6 }` → both tracks 6 s; `{ A: { video: 6, audio: 3 } }` → per track. */
const ends = (o: Record<string, number | StreamEnds>): Map<string, StreamEnds> =>
  new Map(Object.entries(o).map(([id, v]) => [id, typeof v === "number" ? { video: v, audio: v } : v]))
const master = (e: Edl) => e.sources.find((s) => s.role === "master-audio")?.id

describe("assertSegmentsWithinSources", () => {
  it("passes when every window fits the track it reads", () => {
    const e = edl([A, B], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }, { id: "s1", inMs: 1000, outMs: 5000, video: "B" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: 6, B: 6 }))).not.toThrow()
  })

  it("fails naming the segment, the VIDEO source and its video track when the window runs past it", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: 6 })))
      .toThrow(/segment\[0\] "s0" ends at 9\.00s on source "A", but its video track is only 6\.00s long/)
  })

  it("checks the AUDIO source's audio track — the master-audio role, an explicit one, or the picture source by default", () => {
    const viaMaster = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(viaMaster, master(viaMaster), true, ends({ A: 12, MIC: { audio: 6 } })))
      .toThrow(/source "MIC", but its audio track is only 6\.00s/)
    const explicit = edl([A, B], [{ id: "s0", inMs: 0, outMs: 9000, video: "A", audio: "B" }])
    expect(() => assertSegmentsWithinSources(explicit, master(explicit), true, ends({ A: 12, B: 6 })))
      .toThrow(/source "B", but its audio track/)
    const byDefault = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(byDefault, undefined, false, ends({ A: 6 })))
      .toThrow(/source "A", but its audio track/) // audio-only output: the picture source still supplies the sound
  })

  // A file is two tracks. The render's `trim` reads the picture track and
  // `atrim` the sound track; each is checked against its own end.
  it("a source whose picture is shorter than its sound: refused for a video render, fine for an audio-only cut", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    const shortPicture = ends({ A: { video: 3, audio: 6 } })
    expect(() => assertSegmentsWithinSources(e, undefined, true, shortPicture)).toThrow(/its video track is only 3\.00s/)
    expect(() => assertSegmentsWithinSources(e, undefined, false, shortPicture)).not.toThrow()
  })

  it("a source whose sound is shorter than its picture: refused on the audio track — unless the sound comes from elsewhere", () => {
    const own = edl([A], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    const shortSound = ends({ A: { video: 6, audio: 3 } })
    expect(() => assertSegmentsWithinSources(own, undefined, true, shortSound)).toThrow(/its audio track is only 3\.00s/)
    const mic = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    expect(() => assertSegmentsWithinSources(mic, master(mic), true, ends({ A: { video: 6, audio: 3 }, MIC: { audio: 6 } }))).not.toThrow()
  })

  it("an audio-only output does not read the picture source at all", () => {
    const e = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    // A is far too short for the picture, but audio-only never touches it.
    expect(() => assertSegmentsWithinSources(e, master(e), false, ends({ A: 1, MIC: { audio: 12 } }))).not.toThrow()
  })

  it("applies the source's offsetMs before comparing (masterMs = sourceMs + offsetMs)", () => {
    const late = { ...A, offsetMs: 5000 } // this camera started 5 s after the master clock
    const e = edl([late], [{ id: "s0", inMs: 5000, outMs: 11000, video: "A" }]) // 0–6 s of the file
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: 6 }))).not.toThrow()
    const over = edl([late], [{ id: "s0", inMs: 5000, outMs: 13000, video: "A" }]) // 0–8 s of a 6 s file
    expect(() => assertSegmentsWithinSources(over, master(over), true, ends({ A: 6 }))).toThrow(/ends at 8\.00s/)
  })

  it("tolerates a rounding overrun inside SOURCE_END_TOLERANCE_SEC, and refuses beyond it", () => {
    const within = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000, video: "A" }])
    expect(() => assertSegmentsWithinSources(within, undefined, true, ends({ A: 6 }))).not.toThrow()
    const beyond = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000 + 10, video: "A" }])
    expect(() => assertSegmentsWithinSources(beyond, undefined, true, ends({ A: 6 }))).toThrow()
  })

  it("skips a track with no measured end rather than guessing — per track, not per file", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 90_000, video: "A" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({}))).not.toThrow()
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: {} }))).not.toThrow()
    // the sound track is measured and short → refused on it even though the picture is unmeasured
    expect(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: { audio: 6 } }))).toThrow(/audio track/)
  })
})
