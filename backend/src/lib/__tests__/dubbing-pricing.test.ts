import { expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ probe: vi.fn(), rate: vi.fn() }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))
vi.mock("../../providers/elevenlabs/dubbing-project.js", () => ({ validateProjectDubbing: vi.fn() }))
vi.mock("../app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 10 }) }))
vi.mock("../../ee/billing/credits.js", () => ({ getModelCreditBaseCost: mocks.rate }))
import { projectDubbingCreditOverride } from "../dubbing-pricing.js"
it("reserves every started minute using the project rate and trusted duration", async () => {
  mocks.probe.mockResolvedValue(61)
  mocks.rate.mockResolvedValue({ creditCost: 1100 })
  const payload = { targetLanguage: "he", videoUrl: "https://r2.example/video.mp4", probedDurationSec: 1 }
  expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(2420)
  expect(payload.probedDurationSec).toBe(61)
  expect(mocks.rate).toHaveBeenCalledWith("elevenlabs-dubbing-v2")
})
it.each([0, NaN, 1801])("rejects an unpriceable span before reserving: %s", async (duration) => {
  mocks.probe.mockResolvedValue(duration)
  await expect(projectDubbingCreditOverride("dubbing", { targetLanguage: "he", videoUrl: "https://r2.example/video.mp4" })).rejects.toThrow("30 minutes")
})
it("does not change another operation or legacy target's billing", async () => {
  expect(await projectDubbingCreditOverride("dubbing", { targetLanguage: "fr" })).toBeUndefined()
  expect(await projectDubbingCreditOverride("voice-changer", { targetLanguage: "he" })).toBeUndefined()
})
