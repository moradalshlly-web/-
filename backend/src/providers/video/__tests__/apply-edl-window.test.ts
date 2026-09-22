// A segment must exist on the media it reads. Ingress refuses a segment that
// starts before its source's origin; only the downloaded file can say whether
// one runs PAST the source's end, so the executor checks that after download —
// and FAILS naming the segment, never clamps. (A silently shortened segment is a
// shorter render than the EDL, the reserve and the caption remap describe, with
// no error anywhere.) Pure rule, probe results injected: no ffprobe here.
import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared"
import { assertSegmentsWithinSources, SOURCE_END_TOLERANCE_SEC } from "../apply-edl.js"

const A = { id: "A", url: "https://f.test/a.mp4", kind: "video" as const }
const B = { id: "B", url: "https://f.test/b.mp4", kind: "video" as const }
const MIC = { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio" as const, role: "master-audio" as const }

const edl = (sources: Edl["sources"], segments: Array<Record<string, unknown>>): Edl =>
  ({ version: 1, clock: "master", sources, segments }) as unknown as Edl
const lengths = (o: Record<string, number>) => new Map(Object.entries(o))
const master = (e: Edl) => e.sources.find((s) => s.role === "master-audio")?.id

describe("assertSegmentsWithinSources", () => {
  it("passes when every window fits its source", () => {
    const e = edl([A, B], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }, { id: "s1", inMs: 1000, outMs: 5000, video: "B" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, lengths({ A: 6, B: 6 }))).not.toThrow()
  })

  it("fails naming the segment and the VIDEO source when the window runs past it", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, lengths({ A: 6 })))
      .toThrow(/segment\[0\] "s0" ends at 9\.00s on source "A", but that source is only 6\.00s long/)
  })

  it("checks the AUDIO source — the master-audio role, an explicit one, or the picture source by default", () => {
    const viaMaster = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(viaMaster, master(viaMaster), true, lengths({ A: 12, MIC: 6 })))
      .toThrow(/source "MIC", but that source is only 6\.00s/)
    const explicit = edl([A, B], [{ id: "s0", inMs: 0, outMs: 9000, video: "A", audio: "B" }])
    expect(() => assertSegmentsWithinSources(explicit, master(explicit), true, lengths({ A: 12, B: 6 })))
      .toThrow(/source "B"/)
    const byDefault = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(byDefault, undefined, false, lengths({ A: 6 })))
      .toThrow(/source "A"/) // audio-only output: the picture source still supplies the sound
  })

  it("an audio-only output does not read the picture source at all", () => {
    const e = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    // A is far too short for the picture, but audio-only never touches it.
    expect(() => assertSegmentsWithinSources(e, master(e), false, lengths({ A: 1, MIC: 12 }))).not.toThrow()
  })

  it("applies the source's offsetMs before comparing (masterMs = sourceMs + offsetMs)", () => {
    const late = { ...A, offsetMs: 5000 } // this camera started 5 s after the master clock
    const e = edl([late], [{ id: "s0", inMs: 5000, outMs: 11000, video: "A" }]) // 0–6 s of the file
    expect(() => assertSegmentsWithinSources(e, master(e), true, lengths({ A: 6 }))).not.toThrow()
    const over = edl([late], [{ id: "s0", inMs: 5000, outMs: 13000, video: "A" }]) // 0–8 s of a 6 s file
    expect(() => assertSegmentsWithinSources(over, master(over), true, lengths({ A: 6 }))).toThrow(/ends at 8\.00s/)
  })

  it("tolerates a rounding overrun inside SOURCE_END_TOLERANCE_SEC, and refuses beyond it", () => {
    const within = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000, video: "A" }])
    expect(() => assertSegmentsWithinSources(within, undefined, true, lengths({ A: 6 }))).not.toThrow()
    const beyond = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000 + 10, video: "A" }])
    expect(() => assertSegmentsWithinSources(beyond, undefined, true, lengths({ A: 6 }))).toThrow()
  })

  it("skips a source with no probed length rather than guessing", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 90_000, video: "A" }])
    expect(() => assertSegmentsWithinSources(e, master(e), true, lengths({}))).not.toThrow()
  })
})
