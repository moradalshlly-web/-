/**
 * Real-ffmpeg integration test for the apply-edl executor (`../apply-edl.ts`).
 *
 * Follows the still-to-video.e2e / characterization precedent: a synchronous
 * ffmpeg-availability check so a machine without the binary skips cleanly (CI
 * installs ffmpeg), and a partial mock of ONLY `downloadFile` so the executor
 * "downloads" its sources from local lavfi fixtures instead of the network
 * (safeFetch's SSRF guard stays untouched).
 *
 * The synthetic sources encode BOTH channels the render must keep straight:
 *   - source A: solid RED  + a 440 Hz tone
 *   - source B: solid BLUE + an 880 Hz tone
 *   - source C: solid GREEN + a 660 Hz tone, with a +1000 ms master offset
 * so a colour probe verifies SEGMENT ORDER, a Goertzel tone probe verifies
 * AUDIO CONTINUITY + order, and the offset source verifies the D19 sign.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe, probeStreamEnds } from "../ffmpeg-utils.js"
import type { Edl } from "@nodaro/shared"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.APPLY_EDL_FIXTURE_DIR
      if (!dir) throw new Error("fixture dir not set")
      await fs.copyFile(join(dir, basename(new URL(url).pathname)), dest)
    },
  }
})

const { applyEdl } = await import("../apply-edl.js")

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = isFfmpegAvailable()

/** The VBR-mp3 fixture needs libmp3lame; a build without it skips that one case. */
function isMp3EncoderAvailable(): boolean {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] }).toString().includes("libmp3lame")
  } catch {
    return false
  }
}
const mp3EncoderAvailable = ffmpegAvailable && isMp3EncoderAvailable()

async function makeSource(path: string, color: string, freq: number, durationSec: number): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x240:r=30:d=${durationSec}`,
    "-f", "lavfi", "-i", `sine=f=${freq}:r=48000:d=${durationSec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    path,
  ])
}

async function probeDurationSec(path: string): Promise<number> {
  const out = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
  return parseFloat(out.trim())
}

/** Average RGB at output time `t` (scale=1:1 averages the whole frame). */
async function probeColor(path: string, t: number): Promise<{ r: number; g: number; b: number }> {
  const raw = join(tmpdir(), `ae-px-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-ss", String(t), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  return { r: buf[0], g: buf[1], b: buf[2] }
}

function goertzel(samples: Float64Array, sampleRate: number, freq: number): number {
  const k = Math.round((samples.length * freq) / sampleRate)
  const w = (2 * Math.PI * k) / samples.length
  const coeff = 2 * Math.cos(w)
  let s1 = 0, s2 = 0
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/** Dominant tone frequency (from a fixed set) in a 0.4 s window at output time `t`. */
async function probeTone(path: string, t: number, candidates: number[]): Promise<number> {
  const raw = join(tmpdir(), `ae-pcm-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-ss", String(t), "-t", "0.4", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const n = Math.floor(buf.length / 2)
  const samples = new Float64Array(n)
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(i * 2) / 32768
  let best = candidates[0]
  let bestMag = -Infinity
  for (const f of candidates) {
    const mag = goertzel(samples, 8000, f)
    if (mag > bestMag) { bestMag = mag; best = f }
  }
  return best
}

describe.skipIf(!ffmpegAvailable)("applyEdl (real ffmpeg)", () => {
  let dir: string
  let srcA: string, srcB: string, srcC: string, srcVbr: string, srcArt: string, srcLive: string
  let srcLowFps: string, srcV6A3: string, srcV3A6: string, srcOff15: string, srcTs: string
  // Every successful render leaves its work dir (source copies + output) in
  // tmpdir; a failed one is cleaned by applyEdl itself. Collected and removed.
  const renderDirs: string[] = []
  const render = async (opts: Parameters<typeof applyEdl>[0]) => {
    const out = await applyEdl(opts)
    renderDirs.push(dirname(out.outputPath))
    return out
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-test-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    srcA = join(dir, "a.mp4"); srcB = join(dir, "b.mp4"); srcC = join(dir, "c.mp4")
    srcVbr = join(dir, "vbr.mp3"); srcArt = join(dir, "art.mp3"); srcLive = join(dir, "live.mkv")
    srcLowFps = join(dir, "lowfps.mp4"); srcV6A3 = join(dir, "v6a3.mp4"); srcV3A6 = join(dir, "v3a6.mp4")
    srcOff15 = join(dir, "off15.mp4"); srcTs = join(dir, "cam.ts")
    await makeSource(srcA, "red", 440, 6)
    await makeSource(srcB, "blue", 880, 6)
    await makeSource(srcC, "green", 660, 6)
    // A 30 s VBR mp3 with NO Xing/Info header — its container under-reports.
    if (mp3EncoderAvailable) {
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=30", "-c:a", "libmp3lame", "-q:a", "9", "-write_xing", "0", srcVbr])
      // The same, with embedded cover art (an ID3 `attached_pic` video stream —
      // what almost every real podcast mp3 carries). Mapping that "video" into
      // a `-c copy -f null` pass made ffmpeg 8.1 report N/A, so the file went
      // unmeasured; the per-track probe must skip cover art and measure the sound.
      const cover = join(dir, "cover.png")
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=1:d=1", "-frames:v", "1", cover])
      await runFfmpeg(["-y", "-i", srcVbr, "-i", cover, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "png", "-disposition:v", "attached_pic", "-id3v2_version", "3", "-write_xing", "0", srcArt])
    }
    // A 1 fps still-image video (an audiogram) with a 10 s sound track. With
    // B-frames the muxer's clock (`-c copy -f null` out_time) trails the real
    // picture end by the reorder delay in FRAME SPACING — seconds at 1 fps —
    // so a single-number probe refused a segment that ends where the picture
    // really ends. Per-track packet ends read 10 s for both.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:r=1:d=10",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=10",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", srcLowFps,
    ])
    // Tracks of DIFFERENT lengths in one file (no -shortest): picture 6 s +
    // sound 3 s, and picture 3 s + sound 6 s. One number per file cannot
    // describe either; the render reads each track to its own end.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", srcV6A3,
    ])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=3", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", srcV3A6,
    ])
    // A 6 s source whose timestamps START at 1.5 s (`-output_ts_offset`, what
    // a .ts remux, an offset MKV or an mp4 with an initial empty edit look
    // like). Without -copyts the ffmpeg CLI shifts it back to 0 before `trim`
    // sees a frame, so a probe on the file's absolute clock read it 7.5 s long.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-output_ts_offset", "1.5", srcOff15,
    ])
    // An MPEG-TS remux with a large timestamp offset — a broadcast/OBS-style
    // container that re-anchors to the earliest MAPPED stream, so
    // format.start_time is NOT the render's zero. The probe must SKIP it
    // (both tracks unmeasured) rather than measure against the wrong clock.
    await runFfmpeg(["-y", "-i", srcA, "-c", "copy", "-muxdelay", "0", "-output_ts_offset", "3600", "-f", "mpegts", srcTs])
    // A 6 s live-muxed Matroska (what a MediaRecorder writes) — no duration element.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      "-f", "matroska", "-live", "1", srcLive,
    ])
  }, 120_000)

  afterAll(async () => {
    delete process.env.APPLY_EDL_FIXTURE_DIR
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    await Promise.all(renderDirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => {})))
  })

  // Three cut segments A→B→A (each 2 s) → a 6 s output whose colour and tone
  // flip red/440 → blue/880 → red/440 at 1 s / 3 s / 5 s.
  const threeSegmentEdl = (): Edl => ({
    version: 1,
    clock: "master",
    sources: [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 2000, video: "A", audio: "A" },
      { id: "s1", inMs: 0, outMs: 2000, video: "B", audio: "B" },
      { id: "s2", inMs: 2000, outMs: 4000, video: "A", audio: "A" },
    ],
  })

  // A window past the source's end FAILS naming the segment — never a silently
  // shortened render (the EDL, the reserve and the caption remap all describe
  // the longer cut). The fixtures are 6 s long.
  it("fails, naming the segment and source, when a window runs past the media", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://fixtures.test/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 9000, video: "A", audio: "A" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-overrun", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" ends at 9\.00s on source "A"/)
  })

  it("tolerates a sub-second overrun (track skew) and renders to the source's real end", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://fixtures.test/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 6400, video: "A", audio: "A" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-overrun-ok", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.6)
  })

  // The probe reads on the render's clock: a source whose timestamps start at
  // 1.5 s is 6 s long to `trim`, not 7.5. Without subtracting the file's
  // start_time an overrun of up to 1.5 s (an hour, for a broadcast TS) passed
  // the check and the render came out short.
  it("measures a source whose timestamps start late on the render's clock — an overrun is refused, a full cut renders", async () => {
    const sources: Edl["sources"] = [{ id: "CAM", url: "https://fixtures.test/off15.mp4", kind: "video" }]
    const over: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 7300, video: "CAM", audio: "CAM" }] }
    await expect(applyEdl({ edl: over, output: "video", quality: "final", jobId: "t-off-over", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its (video|audio) track is only 6\.\d\ds long/)
    const full: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }] }
    const { outputPath } = await render({ edl: full, output: "video", quality: "final", jobId: "t-off-full", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
  })

  // An MPEG-TS/PS container re-anchors timestamps to the earliest mapped
  // stream, so format.start_time is not the render's clock. The probe must not
  // measure against it (that would refuse correct edits or pass bad ones) — it
  // marks both tracks unmeasured, so the window check skips the source.
  it("marks an MPEG-TS source's tracks unmeasured — the window check is skipped, not made wrong", async () => {
    const ends = await probeStreamEnds(srcTs)
    expect(ends.video.state).toBe("unmeasured")
    expect(ends.audio.state).toBe("unmeasured")
  })

  // The window check measures each source's REAL stream end, not the length
  // its container declares. Two containers that lie, both of which render
  // fine and both of which reach this executor from ordinary uploads:
  //   - an mp3 without a Xing/Info header (a re-cut / ad-stitched podcast
  //     file): ffprobe extrapolates from bitrate and UNDER-reports — a 30 s
  //     VBR encode declares ~27.85 s, and the gap grows with the file;
  //   - a live-muxed Matroska/WebM (a browser MediaRecorder recording):
  //     no duration element at all (`N/A`).
  // A check that trusted the declaration refused the first (a correct edit,
  // "source is only 27.85s long") and threw on the second, after reserve.
  it.skipIf(!mp3EncoderAvailable)("renders an edit to the real end of a VBR mp3 whose container under-reports its length", async () => {
    // Precondition — the fixture must actually lie, or this proves nothing.
    expect(await probeDurationSec(srcVbr)).toBeLessThan(29)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "MIC", url: "https://fixtures.test/vbr.mp3", kind: "audio", role: "master-audio" }],
      segments: [{ id: "s0", inMs: 0, outMs: 30_000 }],
    }
    const { outputPath } = await render({ edl, output: "audio", quality: "final", jobId: "t-vbr", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(29.5)
    expect(dur).toBeLessThan(30.6)
  })

  it("renders from a live-muxed recording whose container declares no duration at all", async () => {
    // Precondition — the container really has nothing to declare.
    expect(Number.isNaN(await probeDurationSec(srcLive))).toBe(true)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/live.mkv", kind: "video" }],
      segments: [{ id: "s0", inMs: 1000, outMs: 5000, video: "CAM", audio: "CAM" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-live", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(3.7)
    expect(dur).toBeLessThan(4.4)
  })

  it("still fails an overrun on a live-muxed recording — the real end is measured, not skipped", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/live.mkv", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 9000, video: "CAM", audio: "CAM" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-live-overrun", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" ends at 9\.00s on source "CAM", but its video track is only 6\.\d\ds long/)
  })

  it.skipIf(!mp3EncoderAvailable)("measures a podcast mp3 with embedded cover art — an overrun on it is refused, a full-length cut renders", async () => {
    // Preconditions — the fixture really carries cover art AND lies about its length.
    const listing = JSON.parse(await runFfprobe(["-v", "error", "-show_entries", "stream=codec_type:stream_disposition=attached_pic", "-of", "json", srcArt])) as { streams: Array<{ codec_type: string; disposition?: { attached_pic?: number } }> }
    expect(listing.streams.some((st) => st.codec_type === "video" && st.disposition?.attached_pic === 1)).toBe(true)
    expect(await probeDurationSec(srcArt)).toBeLessThan(29)
    const sources: Edl["sources"] = [{ id: "MIC", url: "https://fixtures.test/art.mp3", kind: "audio", role: "master-audio" }]
    const over: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 40_000 }] }
    // Refused ⇒ the sound track WAS measured (an unmeasured file would render short, silently).
    await expect(applyEdl({ edl: over, output: "audio", quality: "final", jobId: "t-art-overrun", checkpoint: false }))
      .rejects.toThrow(/source "MIC", but its audio track is only 30\.\d\ds long/)
    const full: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 30_000 }] }
    const { outputPath } = await render({ edl: full, output: "audio", quality: "final", jobId: "t-art", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(29.5)
    expect(dur).toBeLessThan(30.6)
  })

  it.skipIf(!mp3EncoderAvailable)("refuses a picture taken from a file whose only 'video' is cover art — never renders a still", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "POD", url: "https://fixtures.test/art.mp3", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "POD" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-cover-only", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" takes its picture from source "POD", but that source has no video track/)
  })

  it("renders a 1 fps still-image video to its full length — the picture's PTS end, not the muxer's clock — and refuses beyond it", async () => {
    // Precondition — the fixture has B-frame reordering, which is what made the
    // muxer's clock read seconds short. Without it this case proves nothing.
    const bf = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=has_b_frames", "-of", "csv=p=0", srcLowFps])).trim()
    expect(Number(bf)).toBeGreaterThan(0)
    const over: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/lowfps.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 12_000, video: "CAM", audio: "CAM" }],
    }
    // Refused naming 10 s ⇒ the track was MEASURED at its real end (not skipped, not 8 s).
    await expect(applyEdl({ edl: over, output: "video", quality: "final", jobId: "t-lowfps-over", checkpoint: false }))
      .rejects.toThrow(/video track is only 10\.\d\ds long/)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/lowfps.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 10_000, video: "CAM", audio: "CAM" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-lowfps", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(9.5)
    expect(dur).toBeLessThan(10.6)
  })

  it("a file whose picture outlasts its sound: refused on the AUDIO track for a video render, unless the sound comes from a longer source", async () => {
    const own: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/v6a3.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }],
    }
    await expect(applyEdl({ edl: own, output: "video", quality: "final", jobId: "t-v6a3-own", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its audio track is only 3\.\d\ds long/)
    const mic: Edl = {
      version: 1, clock: "master",
      sources: [
        { id: "CAM", url: "https://fixtures.test/v6a3.mp4", kind: "video" },
        { id: "MIC", url: "https://fixtures.test/a.mp4", kind: "audio", role: "master-audio" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM" }],
    }
    const { outputPath } = await render({ edl: mic, output: "video", quality: "final", jobId: "t-v6a3-mic", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
  })

  it("a file whose sound outlasts its picture: an audio-only cut renders to the sound's end, a video render is refused on the VIDEO track", async () => {
    const sources: Edl["sources"] = [{ id: "CAM", url: "https://fixtures.test/v3a6.mp4", kind: "video" }]
    const edl: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }] }
    const { outputPath } = await render({ edl, output: "audio", quality: "final", jobId: "t-v3a6-audio", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-v3a6-video", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its video track is only 3\.\d\ds long/)
  })

  it("renders segment order (colour) + audio continuity (tone) + duration", async () => {
    const edl = threeSegmentEdl()
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-order", checkpoint: false })
    expect(durationMs).toBe(6000)
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)

    const c1 = await probeColor(outputPath, 1)
    expect(c1.r).toBeGreaterThan(c1.b + 40)
    const c3 = await probeColor(outputPath, 3)
    expect(c3.b).toBeGreaterThan(c3.r + 40)
    const c5 = await probeColor(outputPath, 5)
    expect(c5.r).toBeGreaterThan(c5.b + 40)

    expect(await probeTone(outputPath, 1, [440, 880])).toBe(440)
    expect(await probeTone(outputPath, 3, [440, 880])).toBe(880)
    expect(await probeTone(outputPath, 5, [440, 880])).toBe(440)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("chunked render equals single-pass (same duration, colour and tone at every boundary)", async () => {
    const edl = threeSegmentEdl()
    const single = await render({ edl, output: "video", quality: "final", jobId: "t-single", checkpoint: false })
    // Force one chunk PER segment (all boundaries are hard cuts → chunkable),
    // with checkpointing off so no R2 is touched.
    const chunked = await render({ edl, output: "video", quality: "final", jobId: "t-chunked", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 1 })

    expect(chunked.durationMs).toBe(single.durationMs)
    const [ds, dc] = [await probeDurationSec(single.outputPath), await probeDurationSec(chunked.outputPath)]
    expect(Math.abs(ds - dc)).toBeLessThan(0.3)

    for (const t of [1, 3, 5]) {
      const cs = await probeColor(single.outputPath, t)
      const cc = await probeColor(chunked.outputPath, t)
      // Same dominant channel at each boundary.
      expect(Math.sign(cs.r - cs.b)).toBe(Math.sign(cc.r - cc.b))
      expect(await probeTone(chunked.outputPath, t, [440, 880])).toBe(await probeTone(single.outputPath, t, [440, 880]))
    }
    await fs.rm(single.outputPath, { force: true })
    await fs.rm(chunked.outputPath, { force: true })
  }, 180_000)

  it("applies the D19 source offset (masterMs = sourceMs + offsetMs)", async () => {
    // Source C is GREEN/660 with a +1000 ms offset: a segment on master
    // [1000,3000] maps to source time [0,2000], so the render shows green.
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "C", url: "https://fixtures.test/c.mp4", kind: "video", offsetMs: 1000 }],
      segments: [{ id: "s0", inMs: 1000, outMs: 3000, video: "C", audio: "C" }],
    }
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-offset", checkpoint: false })
    expect(durationMs).toBe(2000)
    const c = await probeColor(outputPath, 1)
    expect(c.g).toBeGreaterThan(c.r + 30)
    expect(c.g).toBeGreaterThan(c.b + 30)
    expect(await probeTone(outputPath, 1, [440, 660, 880])).toBe(660)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("renders an audio-only cut (no video graph)", async () => {
    const edl = threeSegmentEdl()
    const { outputPath, durationMs } = await render({ edl, output: "audio", quality: "final", jobId: "t-audio", checkpoint: false })
    expect(durationMs).toBe(6000)
    // No video stream on an audio-only render.
    const vstreams = await runFfprobe(["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type", "-of", "csv=p=0", outputPath])
    expect(vstreams.trim()).toBe("")
    expect(await probeTone(outputPath, 1, [440, 880])).toBe(440)
    expect(await probeTone(outputPath, 3, [440, 880])).toBe(880)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("renders a crossfade boundary (D17: the timeline is overlap-compressed)", async () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
        { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 3000, video: "A", audio: "A" },
        { id: "s1", inMs: 0, outMs: 3000, video: "B", audio: "B", transition: { type: "crossfade", durationMs: 1000 } },
      ],
    }
    // 3000 + 3000 − 1000 overlap = 5000 ms.
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-xfade", checkpoint: false })
    expect(durationMs).toBe(5000)
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(4.6)
    expect(dur).toBeLessThan(5.4)
    await fs.rm(outputPath, { force: true })
  }, 120_000)
})
