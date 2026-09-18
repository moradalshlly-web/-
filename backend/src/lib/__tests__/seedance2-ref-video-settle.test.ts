import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The core shim every lane that completes a Seedance reference-video run
 * calls (the i2v/t2v worker handlers, the reconcile cron). `undefined` means
 * "commit the reservation" — today's behaviour, never an under-bill — so every
 * early exit and the failure path must resolve to it rather than throw.
 */

const edition = vi.hoisted(() => ({ hasCredits: { value: true } }))
vi.mock("../config.js", () => ({
  config: {},
  hasCredits: () => edition.hasCredits.value,
  isCloud: () => edition.hasCredits.value,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// The ee helper is dynamically imported (the credit-guard escape hatch); its
// maths is tested next to it — here only the shim's gating and fallback matter.
const settle = vi.hoisted(() => ({
  actual: vi.fn(async (_args: Record<string, unknown>) => 7193),
  auto: vi.fn(async (_args: Record<string, unknown>) => 311),
}))
vi.mock("../../ee/billing/seedance2-ref-video-credits.js", () => ({
  seedance2RefVideoActualBaseCredits: settle.actual,
  seedance2AutoDurationActualBaseCredits: settle.auto,
}))

import { measureSeedance2RefVideoBaseCredits } from "../seedance2-ref-video-settle.js"

const args = {
  provider: "seedance-2-5",
  resolution: "1080p",
  outputUrl: "https://kie.example/out.mp4",
  referenceVideoUrls: ["https://r2.example.com/videos/ref.mp4"],
}

beforeEach(() => {
  settle.actual.mockClear()
  settle.actual.mockResolvedValue(7193)
  settle.auto.mockClear()
  settle.auto.mockResolvedValue(311)
  edition.hasCredits.value = true
})

describe("measureSeedance2RefVideoBaseCredits", () => {
  it("hands the measured base back for a Seedance run with a reference video", async () => {
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBe(7193)
    expect(settle.actual).toHaveBeenCalledWith(args)
  })

  it("forwards the reservation's probe of the reference clips so the settlement does not probe them again", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, refVideoDurationsSec: [30, null] })
    expect(settle.actual).toHaveBeenCalledWith({ ...args, durationsSec: [30, null] })
  })

  it("a job that carries no probe (in flight across the deploy) sends none — the helper re-probes", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, refVideoDurationsSec: undefined })
    expect(settle.actual).toHaveBeenCalledWith(args)
    expect(settle.actual.mock.calls[0]![0]).not.toHaveProperty("durationsSec")
  })

  it("defaults an unset resolution to 720p — the same default both reservation lanes use", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, resolution: undefined })
    expect(settle.actual).toHaveBeenCalledWith({ ...args, resolution: "720p" })
  })

  it("is not a Seedance run → undefined, no ee module touched", async () => {
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, provider: "veo3.1" })).resolves.toBeUndefined()
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, provider: undefined })).resolves.toBeUndefined()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("no reference video wired → undefined (the -ref composite already prices it)", async () => {
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, referenceVideoUrls: [] })).resolves.toBeUndefined()
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, referenceVideoUrls: undefined })).resolves.toBeUndefined()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("no credits in this edition → undefined without loading the ee helper", async () => {
    edition.hasCredits.value = false
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBeUndefined()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("a failed measurement resolves to undefined (the reservation is committed), never throws", async () => {
    settle.actual.mockRejectedValueOnce(new Error("ffprobe: 403"))
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBeUndefined()
  })

  // AUTO duration with nothing wired is the other worst-case reservation (the
  // model's longest clip) — it settles to the tier of the delivered length.
  describe("auto duration, no reference video", () => {
    const auto = { provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl, referenceVideoUrls: undefined, duration: -1 }

    it("measures the delivered clip", async () => {
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBe(311)
      expect(settle.auto).toHaveBeenCalledWith({ provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl })
      expect(settle.actual).not.toHaveBeenCalled()
    })

    it("a fixed duration with nothing wired still commits its reservation", async () => {
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, duration: 8 })).resolves.toBeUndefined()
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, duration: undefined })).resolves.toBeUndefined()
      expect(settle.auto).not.toHaveBeenCalled()
    })

    it("with a reference video wired, Auto rides the reference lane (input seconds are billed too)", async () => {
      await measureSeedance2RefVideoBaseCredits({ ...args, duration: -1 })
      expect(settle.actual).toHaveBeenCalledTimes(1)
      expect(settle.auto).not.toHaveBeenCalled()
    })

    it("an unmeasurable delivery commits the reservation rather than throwing", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      settle.auto.mockRejectedValue(new Error("ffprobe failed"))
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBeUndefined()
    })

    it("another provider, or an edition without credits, is never measured", async () => {
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, provider: "kling-3.0" })).resolves.toBeUndefined()
      edition.hasCredits.value = false
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBeUndefined()
      expect(settle.auto).not.toHaveBeenCalled()
    })
  })
})
