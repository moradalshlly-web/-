import { describe, it, expect } from "vitest"
import { planFrameDelivery } from "../frame-delivery.js"

const START = "https://cdn.example/start.png"
const END = "https://cdn.example/end.png"

describe("planFrameDelivery", () => {
  it("keeps a frame as a frame on a model whose frame mode measured fine", () => {
    const plan = planFrameDelivery({
      provider: "seedance-2-5", supportsReferenceImages: true, startFrameUrl: START, prompt: "a walk",
    })
    expect(plan).toEqual({ delivery: "frame", referenceImageUrls: [], promptSuffix: "" })
  })

  it("moves the frame into the reference list on the Seedance 2.0 family", () => {
    const plan = planFrameDelivery({
      provider: "seedance-2-fast", supportsReferenceImages: true, startFrameUrl: START,
    })
    expect(plan.delivery).toBe("reference")
    expect(plan.referenceImageUrls).toEqual([START])
    expect(plan.promptSuffix).toBe("Use @image_1 as the opening (first) frame of the video.")
  })

  it("appends frames after the user's own images so their ordinals hold", () => {
    const plan = planFrameDelivery({
      provider: "seedance-2-fast",
      supportsReferenceImages: true,
      startFrameUrl: START,
      endFrameUrl: END,
      userReferenceUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
    })
    expect(plan.referenceImageUrls).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.png", START, END])
    expect(plan.promptSuffix).toContain("@image_3 as the opening (first) frame")
    expect(plan.promptSuffix).toContain("@image_4 as the closing (last) frame")
  })

  it("adds no second opening sentence when the prompt already binds one", () => {
    const plan = planFrameDelivery({
      provider: "seedance-2-fast",
      supportsReferenceImages: true,
      startFrameUrl: START,
      prompt: "Use @image_1 as the first frame, it is the last keyframe of @video_1",
    })
    expect(plan.delivery).toBe("reference")
    expect(plan.promptSuffix).toBe("")
  })

  it("honours an explicit choice in both directions", () => {
    expect(planFrameDelivery({
      provider: "seedance-2-fast", requested: "frame", supportsReferenceImages: true, startFrameUrl: START,
    }).delivery).toBe("frame")
    expect(planFrameDelivery({
      provider: "veo3.1", requested: "reference", supportsReferenceImages: true, startFrameUrl: START,
    }).delivery).toBe("reference")
  })

  it("refuses, with a reason, on a model that takes no reference images", () => {
    const plan = planFrameDelivery({
      provider: "wan-i2v", requested: "reference", supportsReferenceImages: false, startFrameUrl: START,
    })
    expect(plan).toMatchObject({ delivery: "frame", refusedReason: "no-reference-support" })
  })

  it("refuses rather than displace a user's reference image at the cap", () => {
    const refs = Array.from({ length: 9 }, (_, i) => `https://cdn.example/ref-${i}.png`)
    const plan = planFrameDelivery({
      provider: "seedance-2-fast", supportsReferenceImages: true, startFrameUrl: START, userReferenceUrls: refs,
    })
    expect(plan).toMatchObject({ delivery: "frame", refusedReason: "image-cap" })
    expect(plan.referenceImageUrls).toEqual(refs)
  })

  it("is a no-op when no frame is wired", () => {
    const plan = planFrameDelivery({ provider: "seedance-2-fast", supportsReferenceImages: true })
    expect(plan).toEqual({ delivery: "frame", referenceImageUrls: [], promptSuffix: "" })
  })

  it("plans the same shape whether it is asked with urls or with stand-ins", () => {
    // The config panel knows a frame is wired before it knows its url, so it
    // passes placeholders. Ordering and sentences must not depend on the string.
    const real = planFrameDelivery({
      provider: "seedance-2-mini", supportsReferenceImages: true, startFrameUrl: START, endFrameUrl: END,
      userReferenceUrls: ["https://cdn.example/a.png"],
    })
    const preview = planFrameDelivery({
      provider: "seedance-2-mini", supportsReferenceImages: true, startFrameUrl: "frame:start", endFrameUrl: "frame:end",
      userReferenceUrls: ["ref:0"],
    })
    expect(preview.delivery).toBe(real.delivery)
    expect(preview.promptSuffix).toBe(real.promptSuffix)
    expect(preview.referenceImageUrls).toHaveLength(real.referenceImageUrls.length)
  })
})
