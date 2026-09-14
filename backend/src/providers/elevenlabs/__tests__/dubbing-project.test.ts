import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), merge: vi.fn(), read: vi.fn(), download: vi.fn(), ffmpeg: vi.fn(), cleanup: vi.fn() }))
vi.mock("../../egress.js", () => ({ providerFetch: mocks.fetch }))
vi.mock("../client.js", () => ({ ELEVENLABS_BASE_URL: "https://api.elevenlabs.io", getElevenLabsHeaders: () => ({ "xi-api-key": "secret" }) }))
vi.mock("../../video/merge-video-audio.js", () => ({ mergeVideoAudio: mocks.merge }))
vi.mock("../../video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/project-audio"), cleanupWorkDir: mocks.cleanup,
  downloadFile: mocks.download, runFfmpeg: mocks.ffmpeg,
}))
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }))
import { downloadDubbingProject } from "../dubbing-project.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockImplementation(async (_meta, url: string) => ({ ok: true, json: async () => url.includes("/language/")
    ? { status: "completed", outputs: { lossless_audio: "https://storage.example/fresh.flac" } }
    : { status: "ready", language_ids: ["lang"] } }))
  mocks.merge.mockResolvedValue("/tmp/merge/output.mp4")
  mocks.read.mockResolvedValue(Buffer.from("converted-media"))
})

describe("project dubbing delivery", () => {
  it("replaces video audio using the source and a fresh signed FLAC URL", async () => {
    const output = await downloadDubbingProject("project:pid", true, "https://media.example/source.mp4")
    expect(output.toString()).toBe("converted-media")
    expect(mocks.merge).toHaveBeenCalledWith({ videoUrl: "https://media.example/source.mp4", audioUrl: "https://storage.example/fresh.flac", keepOriginalAudio: false })
    expect(mocks.read).toHaveBeenCalledWith("/tmp/merge/output.mp4")
    expect(mocks.cleanup).toHaveBeenCalledWith("/tmp/merge")
    expect(mocks.fetch.mock.calls.every(c => c[2].method === "GET")).toBe(true)
  })
  it("transcodes audio output instead of labeling FLAC bytes as MP3", async () => {
    await downloadDubbingProject("project:pid", false)
    expect(mocks.download).toHaveBeenCalledWith("https://storage.example/fresh.flac", "/tmp/project-audio/dub.flac")
    expect(mocks.ffmpeg).toHaveBeenCalledWith(expect.arrayContaining(["libmp3lame", "/tmp/project-audio/dub.mp3"]))
    expect(mocks.read).toHaveBeenCalledWith("/tmp/project-audio/dub.mp3")
    expect(mocks.merge).not.toHaveBeenCalled()
  })
  it("does not deliver stale outputs", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", language_ids: ["lang"] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "stale", outputs: { lossless_audio: "https://storage.example/stale.flac" } }) })
    await expect(downloadDubbingProject("project:pid", false)).rejects.toThrow("not ready")
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.merge).not.toHaveBeenCalled()
  })
  it("cleans temporary files on conversion failure and tags it as post-processing", async () => {
    mocks.ffmpeg.mockRejectedValueOnce(new Error("bad media"))
    await expect(downloadDubbingProject("project:pid", false)).rejects.toMatchObject({ name: "PostProcessingError" })
    expect(mocks.cleanup).toHaveBeenCalledWith("/tmp/project-audio")
  })
})
