/**
 * Real-ffmpeg regression test for the kinetic-caption audio restore
 * (`restoreVideoAudioFromSource`), guarding the "silent captioned output" bug.
 *
 * Repro that motivated it: a 25s 1080x1920 clip whose audio is **AAC 32000 Hz**
 * (Seedance/composite output) was captioned via a kinetic style. The Remotion
 * render is silent (its input is transcoded `-an` for fast seeking) and carries
 * a 48 kHz `enforceAudioTrack` silence track; the worker must mux the source's
 * audio back. The delivered output measured mean_volume -91 dB at 48 kHz — the
 * synthesised-silence signature — because the restore was absent. This asserts
 * the restore puts real signal back for a 32 kHz AAC source and stream-copies
 * it (no resample-to-silence).
 *
 * Follows the still-to-video.e2e precedent: a synchronous ffmpeg-availability
 * check skips cleanly on a machine without ffmpeg (CI installs the pinned
 * binary for the real-ffmpeg e2e tests). It is a version-INSENSITIVE threshold
 * (signal ~ -3 dB vs silence ~ -91 dB — a 30 dB gap), so unlike the golden
 * characterization suite it is safe in the default test glob.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { restoreVideoAudioFromSource } from "../ffmpeg-utils.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = isFfmpegAvailable()

function ff(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`ffmpeg fixture gen failed: ${r.stderr}`)
}

/** mean_volume in dB from ffmpeg's volumedetect (writes to stderr). */
function meanVolumeDb(path: string): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" })
  const m = r.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)
  if (!m) throw new Error(`no mean_volume in ffmpeg output: ${r.stderr}`)
  return parseFloat(m[1]!)
}

function audioStreamInfo(path: string): { codec: string; sampleRate: number } {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate", "-of", "csv=p=0", path], { encoding: "utf8" })
  const [codec, sr] = r.stdout.trim().split(",")
  return { codec: codec ?? "", sampleRate: Number(sr) }
}

describe.skipIf(!ffmpegAvailable)("restoreVideoAudioFromSource — 32 kHz AAC source (silent-caption regression)", () => {
  let dir: string
  let source32k: string // audio-bearing 32 kHz AAC source (the Seedance-shaped input)
  let silentRender: string // 48 kHz silent "Remotion render"

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cap-audio-restore-"))
    source32k = join(dir, "source-32k.mp4")
    silentRender = join(dir, "silent-48k.mp4")
    // Source: 3s video + a 440 Hz sine at 32000 Hz stereo AAC — the reported audio shape.
    ff(["-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=3",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000:duration=3",
        "-c:v", "libx264", "-c:a", "aac", "-ar", "32000", "-ac", "2", "-shortest", source32k])
    // Silent render: video + a 48 kHz silent stereo AAC track (Remotion's enforced silence).
    ff(["-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=3",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", silentRender])
  }, 60_000)

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it("baseline: the silent render really is silent (the assertion can tell signal from silence)", () => {
    expect(meanVolumeDb(silentRender)).toBeLessThan(-80)
  })

  it("restores real audio onto the captioned render (mean_volume > -60 dB, not the -91 dB silence)", async () => {
    const out = join(dir, "restored.mp4")
    const ok = await restoreVideoAudioFromSource(silentRender, source32k, out)
    expect(ok).toBe(true)
    expect(meanVolumeDb(out)).toBeGreaterThan(-60)
  }, 60_000)

  it("stream-copies the 32 kHz AAC source rather than resampling it to 48 kHz silence", async () => {
    const out = join(dir, "restored-copy.mp4")
    await restoreVideoAudioFromSource(silentRender, source32k, out)
    const info = audioStreamInfo(out)
    expect(info.codec).toBe("aac")
    expect(info.sampleRate).toBe(32000)
  }, 60_000)
})
