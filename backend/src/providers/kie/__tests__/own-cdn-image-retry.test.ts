import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"

// The defect site itself (app-reports lane G, 2026-09-04): two seedance-2-5
// image-to-video jobs died in `ensureImageForProvider` with `Failed to
// download image: HTTP 404` on a `cdn.nodaro.ai` object we had written
// ourselves — one GET, no retry, credits already reserved. These tests drive
// the REAL helper and assert the whole path: our host's 404 is retried and the
// frame is normalized as usual; a foreign host's 404 still fails on the spot
// with the same message.

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  sleep: vi.fn(async () => {}),
}))

vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/sleep.js", () => ({ sleep: mocks.sleep }))

const { ensureImageForProvider } = await import("../video.js")

const OWN = "https://cdn.nodaro.test/images/frame.png"
const FOREIGN = "https://elsewhere.example/frame.png"

const reply = (status: number, buffer?: Buffer) => ({
  ok: status >= 200 && status < 300,
  status,
  body: { cancel: async () => {} },
  arrayBuffer: async () => buffer ?? Buffer.alloc(0),
})

/** Small enough that no conversion/resize happens — the helper returns the
 *  input URL untouched, which makes "did the download succeed?" observable. */
const smallPng = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } })
    .png()
    .toBuffer()

describe("ensureImageForProvider — our own CDN answering 404", () => {
  const prev = process.env.R2_PUBLIC_URL

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = prev
    vi.restoreAllMocks()
  })

  it("404 then 200 on our own host: the frame goes through instead of failing the job", async () => {
    const png = await smallPng()
    mocks.safeFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(200, png))
    await expect(
      ensureImageForProvider(OWN, "seedance-2-5", { context: "Video generation", maxDimension: 2048 }),
    ).resolves.toBe(OWN)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
  })

  it("a persistent 404 still fails with the SAME error (only later)", async () => {
    mocks.safeFetch.mockResolvedValue(reply(404))
    // `createSanitizedError` keeps the operator text on `internalDetails`; the
    // user-facing sentence is unchanged by this PR.
    await expect(
      ensureImageForProvider(OWN, "seedance-2-5", { context: "Video generation", maxDimension: 2048 }),
    ).rejects.toMatchObject({
      internalDetails: expect.stringContaining("Failed to download image: HTTP 404"),
    })
    expect(mocks.safeFetch.mock.calls.length).toBeGreaterThan(1)
  })

  it("a foreign host's 404 fails on the first try — no added wait", async () => {
    mocks.safeFetch.mockResolvedValue(reply(404))
    await expect(
      ensureImageForProvider(FOREIGN, "seedance-2-5", { context: "Video generation", maxDimension: 2048 }),
    ).rejects.toMatchObject({
      internalDetails: expect.stringContaining("Failed to download image: HTTP 404"),
    })
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
    expect(mocks.sleep).not.toHaveBeenCalled()
  })
})
