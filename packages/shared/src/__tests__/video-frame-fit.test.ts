import { describe, it, expect } from "vitest"
import {
  computeFrameFitPlan,
  resolveFrameFitAspect,
  resolveFrameDelivery,
  minimalRatioDimensions,
  centreCropToAspect,
  parseAspectToken,
  FRAME_FIT_STRETCH_TOLERANCE,
} from "../video-frame-fit.js"
import { resolveOutputCanvas, measuredCanvasCombinations } from "../video-output-canvas.js"

/** The image behind every number in this file: a 1K 9:16 GPT image. */
const GPT_1K = { sourceWidth: 940, sourceHeight: 1672 }

describe("measured output canvases", () => {
  it("answers the combinations we measured, case-insensitively on resolution", () => {
    expect(resolveOutputCanvas("seedance-2-5", "720p", "9:16")).toEqual([720, 1280])
    expect(resolveOutputCanvas("minimax-h3", "768P", "9:16")).toEqual([768, 1344])
    expect(resolveOutputCanvas("minimax-h3", "2K", "16:9")).toEqual([2560, 1440])
  })

  it("keeps the 2.0 family apart from 2.5 at 480p — they really do differ", () => {
    expect(resolveOutputCanvas("seedance-2-5", "480p", "16:9")).toEqual([854, 480])
    expect(resolveOutputCanvas("seedance-2-fast", "480p", "16:9")).toEqual([864, 496])
  })

  it("answers undefined for anything never measured", () => {
    expect(resolveOutputCanvas("seedance-2-5", "4k", "9:16")).toBeUndefined()
    expect(resolveOutputCanvas("kling-3.0", "720p", "16:9")).toBeUndefined()
    expect(resolveOutputCanvas(undefined, "720p", "9:16")).toBeUndefined()
  })

  it("stores only even, positive dimensions", () => {
    for (const { provider, resolution, aspect, canvas } of measuredCanvasCombinations()) {
      const where = `${provider} ${resolution} ${aspect}`
      expect(canvas[0] % 2, where).toBe(0)
      expect(canvas[1] % 2, where).toBe(0)
      expect(canvas[0] > 0 && canvas[1] > 0, where).toBe(true)
    }
  })

  it("does not claim a canvas whose ratio is wildly off the label", () => {
    // H3's 768P 9:16 really is 0.5714 — a 1.6% lie we keep on purpose. Anything
    // further out is a typo, not a provider quirk.
    for (const { provider, resolution, aspect, canvas } of measuredCanvasCombinations()) {
      const label = parseAspectToken(aspect)
      if (label === undefined) continue
      const actual = canvas[0] / canvas[1]
      expect(Math.abs(actual - label) / label, `${provider} ${resolution} ${aspect}`).toBeLessThan(0.06)
    }
  })
})

describe("aspect resolution", () => {
  it("uses an explicit ratio as-is", () => {
    expect(resolveFrameFitAspect({ provider: "seedance-2-5", requestedAspect: "16:9", ...GPT_1K })).toBe("16:9")
  })

  it("snaps adaptive and Auto to the model's nearest listed ratio", () => {
    // 940x1672 = 0.5622, which is 9:16 to within 0.05%.
    expect(resolveFrameFitAspect({ provider: "seedance-2-5", requestedAspect: "adaptive", ...GPT_1K })).toBe("9:16")
    expect(resolveFrameFitAspect({ provider: "seedance-2-5", requestedAspect: "Auto", ...GPT_1K })).toBe("9:16")
    expect(resolveFrameFitAspect({ provider: "seedance-2-5", requestedAspect: undefined, sourceWidth: 1920, sourceHeight: 1080 })).toBe("16:9")
  })

  it("gives up when the model declares no ratios", () => {
    expect(resolveFrameFitAspect({ provider: "not-a-model", requestedAspect: "adaptive", ...GPT_1K })).toBeUndefined()
  })
})

describe("computeFrameFitPlan", () => {
  it("resizes the 1K image to the measured canvas — the case that fixed the snap", () => {
    const plan = computeFrameFitPlan({
      fit: "resolution", provider: "seedance-2-5", resolution: "720p", aspect: "9:16", ...GPT_1K,
    })
    expect(plan).toEqual({ width: 720, height: 1280, reason: "resolution" })
  })

  it("targets H3's real 768x1344 canvas rather than a true 9:16", () => {
    const plan = computeFrameFitPlan({
      fit: "resolution", provider: "minimax-h3", resolution: "768P", aspect: "9:16", ...GPT_1K,
    })
    expect(plan?.width).toBe(768)
    expect(plan?.height).toBe(1344)
    expect(plan?.crop).toBeUndefined()   // 1.6% gap is inside the tolerance → stretch
  })

  it("does nothing when the frame is already the canvas", () => {
    expect(computeFrameFitPlan({
      fit: "resolution", provider: "seedance-2-5", resolution: "720p", aspect: "9:16",
      sourceWidth: 720, sourceHeight: 1280,
    })).toBeNull()
  })

  it("does nothing in original mode, whatever the size", () => {
    expect(computeFrameFitPlan({
      fit: "original", provider: "seedance-2-5", resolution: "720p", aspect: "9:16", ...GPT_1K,
    })).toBeNull()
  })

  it("degrades resolution → ratio when the combination was never measured", () => {
    const plan = computeFrameFitPlan({
      fit: "resolution", provider: "seedance-2-5", resolution: "4k", aspect: "16:9",
      sourceWidth: 1000, sourceHeight: 1000,
    })
    // No 4k canvas on file, so it falls back to the minimal change that makes 16:9.
    expect(plan?.reason).toBe("ratio")
    expect(plan!.width / plan!.height).toBeCloseTo(16 / 9, 2)
  })

  it("degrades to nothing when neither a canvas nor an aspect can be resolved", () => {
    expect(computeFrameFitPlan({
      fit: "resolution", provider: "not-a-model", resolution: "720p", aspect: undefined, ...GPT_1K,
    })).toBeNull()
  })

  it("stretches inside the tolerance and crops outside it", () => {
    // 4% off 9:16 — inside 5%, so a plain stretch, no crop.
    const inside = computeFrameFitPlan({
      fit: "ratio", provider: "seedance-2-5", resolution: "720p", aspect: "9:16",
      sourceWidth: 1000, sourceHeight: 1710,
    })
    expect(Math.abs(1000 / 1710 - 9 / 16) / (9 / 16)).toBeLessThan(FRAME_FIT_STRETCH_TOLERANCE)
    expect(inside?.crop).toBeUndefined()

    // A square photo into 9:16 is a 78% gap — crop first, never squash.
    const outside = computeFrameFitPlan({
      fit: "resolution", provider: "seedance-2-5", resolution: "720p", aspect: "9:16",
      sourceWidth: 1024, sourceHeight: 1024,
    })
    expect(outside).toMatchObject({ width: 720, height: 1280, reason: "resolution" })
    expect(outside?.crop).toEqual({ left: 224, top: 0, width: 576, height: 1024 })
    expect(outside!.crop!.width / outside!.crop!.height).toBeCloseTo(9 / 16, 3)
  })

  it("produces even dimensions (yuv420p rejects odd ones)", () => {
    const plan = computeFrameFitPlan({
      fit: "ratio", provider: "seedance-2-5", resolution: "720p", aspect: "16:9",
      sourceWidth: 1001, sourceHeight: 667,
    })
    expect(plan!.width % 2).toBe(0)
    expect(plan!.height % 2).toBe(0)
  })
})

describe("geometry helpers", () => {
  it("minimalRatioDimensions keeps the long side and moves the short one", () => {
    // 940 wide is 9:16 at 1671.1 tall, which rounds back to the image's own
    // 1672 — the 1K GPT image really is 9:16 to the nearest even pixel, so
    // "match ratio" alone would leave it untouched (and the snap would stay).
    expect(minimalRatioDimensions(940, 1672, 9 / 16)).toEqual({ width: 940, height: 1672 })
    expect(minimalRatioDimensions(1920, 1000, 16 / 9)).toEqual({ width: 1920, height: 1080 })
  })

  it("centreCropToAspect drops the overhang evenly", () => {
    expect(centreCropToAspect(1024, 1024, 9 / 16)).toEqual({ left: 224, top: 0, width: 576, height: 1024 })
    expect(centreCropToAspect(1000, 1000, 16 / 9)).toEqual({ left: 0, top: 219, width: 1000, height: 562 })
  })

  it("parseAspectToken reads the tokens the catalog uses", () => {
    expect(parseAspectToken("16:9")).toBeCloseTo(16 / 9, 6)
    expect(parseAspectToken("9:16")).toBeCloseTo(9 / 16, 6)
    expect(parseAspectToken("adaptive")).toBeUndefined()
    expect(parseAspectToken(undefined)).toBeUndefined()
  })
})

describe("frame delivery", () => {
  it("sends the Seedance 2.0 family as references and everything else as frames", () => {
    const ref = { requested: "auto" as const, supportsReferenceImages: true }
    expect(resolveFrameDelivery({ provider: "seedance-2-fast", ...ref })).toBe("reference")
    expect(resolveFrameDelivery({ provider: "seedance-2", ...ref })).toBe("reference")
    expect(resolveFrameDelivery({ provider: "seedance-2-mini", ...ref })).toBe("reference")
    expect(resolveFrameDelivery({ provider: "seedance-2-5", ...ref })).toBe("frame")
    expect(resolveFrameDelivery({ provider: "wan-3", ...ref })).toBe("frame")
    expect(resolveFrameDelivery({ provider: "veo3.1", ...ref })).toBe("frame")
  })

  it("honours an explicit choice", () => {
    expect(resolveFrameDelivery({ provider: "seedance-2-fast", requested: "frame", supportsReferenceImages: true })).toBe("frame")
    expect(resolveFrameDelivery({ provider: "veo3.1", requested: "reference", supportsReferenceImages: true })).toBe("reference")
  })

  it("never asks for reference delivery on a model that takes no references", () => {
    expect(resolveFrameDelivery({ provider: "seedance-2-fast", requested: "auto", supportsReferenceImages: false })).toBe("frame")
    expect(resolveFrameDelivery({ provider: "wan-i2v", requested: "reference", supportsReferenceImages: false })).toBe("frame")
  })
})
