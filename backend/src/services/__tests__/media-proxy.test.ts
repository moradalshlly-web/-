import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks must replace the bindings BEFORE the module under test imports them.
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/media-proxy-work"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(""),
}))
vi.mock("../../lib/storage.js", () => ({
  getR2ObjectSize: vi.fn().mockResolvedValue(0),
  r2KeyFromOurUrl: vi.fn().mockReturnValue(null), // treat every source as an external URL
  r2Url: vi.fn((key: string) => `https://cdn.test/${key}`),
  uploadLocalFileToR2Key: vi.fn((_f: string, key: string) => Promise.resolve(`https://cdn.test/${key}`)),
}))

import { createWorkDir, cleanupWorkDir, downloadFile, runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { getR2ObjectSize, uploadLocalFileToR2Key } from "../../lib/storage.js"
import { ensureMediaProxy, mediaProxyKey } from "../media-proxy.js"

const SRC = "https://example.com/episode.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createWorkDir).mockResolvedValue("/tmp/media-proxy-work")
  vi.mocked(getR2ObjectSize).mockResolvedValue(0)
})

describe("mediaProxyKey", () => {
  it("is stable for the same source/kind/fps and under the proxies/ prefix", () => {
    expect(mediaProxyKey(SRC, "audio")).toBe(mediaProxyKey(SRC, "audio"))
    expect(mediaProxyKey(SRC, "audio")).toMatch(/^proxies\/[0-9a-f]{40}\/audio\.m4a$/)
    expect(mediaProxyKey(SRC, "video", 15)).toMatch(/^proxies\/[0-9a-f]{40}\/video@15fps\.mp4$/)
  })

  it("varies by kind, by fps, and by source", () => {
    expect(mediaProxyKey(SRC, "audio")).not.toBe(mediaProxyKey(SRC, "video"))
    expect(mediaProxyKey(SRC, "video", 2)).not.toBe(mediaProxyKey(SRC, "video", 15))
    expect(mediaProxyKey(SRC, "audio")).not.toBe(mediaProxyKey("https://other/x.mp4", "audio"))
  })
})

describe("ensureMediaProxy — cache hit", () => {
  it("returns the cached url without downloading or encoding", async () => {
    vi.mocked(getR2ObjectSize).mockResolvedValue(4242)
    const r = await ensureMediaProxy(SRC, "audio")
    expect(r.cached).toBe(true)
    expect(r.url).toBe(`https://cdn.test/${mediaProxyKey(SRC, "audio")}`)
    expect(downloadFile).not.toHaveBeenCalled()
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(uploadLocalFileToR2Key).not.toHaveBeenCalled()
  })
})

describe("ensureMediaProxy — cache miss", () => {
  it("downloads, encodes an audio proxy (16kHz mono AAC, no video), uploads, cleans up", async () => {
    const r = await ensureMediaProxy(SRC, "audio")
    expect(r.cached).toBe(false)
    expect(downloadFile).toHaveBeenCalledOnce()
    const [args, timeout] = vi.mocked(runFfmpeg).mock.calls[0]
    const a = args.join(" ")
    expect(a).toContain("-vn")
    expect(a).toContain("-ac 1")
    expect(a).toContain("-ar 16000")
    expect(a).toContain("-c:a aac")
    expect(timeout).toBeGreaterThan(10 * 60_000) // longer than the default per-spawn ceiling
    expect(uploadLocalFileToR2Key).toHaveBeenCalledOnce()
    expect(cleanupWorkDir).toHaveBeenCalledWith("/tmp/media-proxy-work")
  })

  it("encodes a 360p low-fps video proxy with no audio", async () => {
    await ensureMediaProxy(SRC, "video", { fps: 2 })
    const a = vi.mocked(runFfmpeg).mock.calls[0][0].join(" ")
    expect(a).toContain("-an")
    expect(a).toContain("scale=-2:360")
    expect(a).toContain("-r 2")
    expect(a).toContain("libx264")
  })

  it("cleans up the work dir even when the encode fails", async () => {
    vi.mocked(runFfmpeg).mockRejectedValueOnce(new Error("ffmpeg failed: boom"))
    await expect(ensureMediaProxy(SRC, "audio")).rejects.toThrow(/boom/)
    expect(cleanupWorkDir).toHaveBeenCalledWith("/tmp/media-proxy-work")
  })
})
