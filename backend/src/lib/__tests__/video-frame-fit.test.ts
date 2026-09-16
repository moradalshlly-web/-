/**
 * `prepareVideoFrames` against REAL sharp pixels — only the network (the
 * download) and R2 (the upload) are stubbed, because the thing worth proving is
 * that the bytes come out at the model's measured canvas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

const downloads = new Map<string, Buffer>()
const uploads: Array<{ key: string; contentType: string; buffer: Buffer }> = []

vi.mock("../fetch-own-media.js", () => ({
  fetchOwnMedia: async (url: string) => {
    const buf = downloads.get(url)
    if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  },
}))

vi.mock("../storage.js", () => ({
  uploadBufferToR2: async (buffer: Buffer, key: string, contentType: string) => {
    uploads.push({ key, contentType, buffer })
    return `https://cdn.test/${key}`
  },
  r2Url: (key: string) => `https://cdn.test/${key}`,
}))

const { prepareVideoFrames } = await import("../video-frame-fit.js")

async function png(width: number, height: number, url: string): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 90, b: 30 } },
  }).png().toBuffer()
  downloads.set(url, buf)
  return url
}

beforeEach(() => {
  downloads.clear()
  uploads.length = 0
})

describe("prepareVideoFrames", () => {
  it("resizes a 1K 9:16 frame to Seedance 2.5's measured 720x1280 canvas", async () => {
    const url = await png(940, 1672, "https://cdn.test/src-1k.png")
    const out = await prepareVideoFrames({
      provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: url,
    })

    expect(out.imageUrl).not.toBe(url)
    expect(uploads).toHaveLength(1)
    const meta = await sharp(uploads[0]!.buffer).metadata()
    expect([meta.width, meta.height]).toEqual([720, 1280])
    expect(out.applied[0]).toMatchObject({
      role: "start",
      from: { width: 940, height: 1672 },
      to: { width: 720, height: 1280 },
      cropped: false,
      reason: "resolution",
    })
  })

  it("fits the end frame too, and the two share nothing but the settings", async () => {
    const start = await png(940, 1672, "https://cdn.test/s.png")
    const end = await png(1024, 1024, "https://cdn.test/e.png")
    const out = await prepareVideoFrames({
      provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: start, endFrameUrl: end,
    })
    expect(out.applied.map((a) => a.role)).toEqual(["start", "end"])
    // The square end frame is 78% off 9:16 → cropped to the ratio, then resized.
    expect(out.applied[1]).toMatchObject({ cropped: true, to: { width: 720, height: 1280 } })
    for (const up of uploads) {
      const meta = await sharp(up.buffer).metadata()
      expect([meta.width, meta.height]).toEqual([720, 1280])
    }
  })

  it("leaves a frame that is already the canvas untouched, and uploads nothing", async () => {
    const url = await png(720, 1280, "https://cdn.test/exact.png")
    const out = await prepareVideoFrames({
      provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: url,
    })
    expect(out.imageUrl).toBe(url)
    expect(out.applied).toEqual([])
    expect(uploads).toHaveLength(0)
  })

  it("leaves the frame alone for a combination we have never measured", async () => {
    const url = await png(940, 1672, "https://cdn.test/unmeasured.png")
    const out = await prepareVideoFrames({
      provider: "kling-3.0", resolution: "1080p", aspectRatio: "9:16", imageUrl: url,
    })
    // No canvas on file and 940x1672 is already 9:16 to the nearest even pixel,
    // so the ratio fallback has nothing to do either.
    expect(out.imageUrl).toBe(url)
    expect(uploads).toHaveLength(0)
  })

  it("does nothing at all in original mode", async () => {
    const url = await png(940, 1672, "https://cdn.test/orig.png")
    const out = await prepareVideoFrames({
      provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: url, fit: "original",
    })
    expect(out.imageUrl).toBe(url)
    expect(uploads).toHaveLength(0)
  })

  it("uploads once for the same source and target, twice for different targets", async () => {
    const url = await png(940, 1672, "https://cdn.test/cache.png")
    const args = { provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: url } as const
    const first = await prepareVideoFrames(args)
    const second = await prepareVideoFrames(args)
    expect(second.imageUrl).toBe(first.imageUrl)
    expect(uploads).toHaveLength(1)

    await prepareVideoFrames({ ...args, resolution: "480p" })
    expect(uploads).toHaveLength(2)
    expect(uploads[1]!.key).not.toBe(uploads[0]!.key)
  })

  it("sends the original frame when the download fails — never fails the render", async () => {
    const out = await prepareVideoFrames({
      provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16",
      imageUrl: "https://cdn.test/missing.png",
    })
    expect(out.imageUrl).toBe("https://cdn.test/missing.png")
    expect(out.applied).toEqual([])
  })

  it("targets H3's real 768x1344 canvas rather than a true 9:16", async () => {
    const url = await png(940, 1672, "https://cdn.test/h3.png")
    await prepareVideoFrames({ provider: "minimax-h3", resolution: "768P", aspectRatio: "9:16", imageUrl: url })
    const meta = await sharp(uploads[0]!.buffer).metadata()
    expect([meta.width, meta.height]).toEqual([768, 1344])
  })

  it("keeps png as png (an alpha frame must not become jpeg)", async () => {
    const url = await png(940, 1672, "https://cdn.test/keep.png")
    await prepareVideoFrames({ provider: "seedance-2-5", resolution: "720p", aspectRatio: "9:16", imageUrl: url })
    expect(uploads[0]!.contentType).toBe("image/png")
    expect(uploads[0]!.key.endsWith(".png")).toBe(true)
  })
})
