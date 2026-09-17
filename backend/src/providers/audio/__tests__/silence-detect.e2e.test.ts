/**
 * Real-ffmpeg e2e for `runSilenceDetectOnFile` (silence-detect.ts).
 *
 * Same lavfi fixture idiom as trim-edge-frames.e2e.test.ts / slideshow.e2e —
 * spawns the actual ffmpeg binary. A 6 s tone muted between t=2..4 must recover
 * exactly one silence range near [2 s, 4 s], shrunk inward by the pad. The pure
 * parse/pad logic is covered hermetically in silence-detect.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg } from "../../video/ffmpeg-utils.js"
import { runSilenceDetectOnFile } from "../silence-detect.js"

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
