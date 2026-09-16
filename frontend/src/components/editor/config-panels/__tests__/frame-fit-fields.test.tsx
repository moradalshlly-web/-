/**
 * Start/end frame handling controls (`FrameFitFields`) — pins the surface:
 *   - nothing renders without a wired frame;
 *   - delivery is hidden on models with no reference-image support;
 *   - the auto option names what it resolves to (reference on the Seedance 2.0
 *     family, frame everywhere else);
 *   - unset values read as their defaults, and the canvas hint appears only
 *     for a MEASURED (model, resolution, aspect) trio;
 *   - `previewFrameDelivery` mirrors the backend dispatch order so the
 *     resolved-mode indicator stays honest.
 */
import { describe, it, expect, vi } from "vitest"
import { Children, createElement, type ReactNode } from "react"
import { render } from "@testing-library/react"

// Radix Select mounts its items in a portal; register each (value, onValueChange)
// under its trigger id and render items inline so labels land in the DOM.
const { selectRegistry } = vi.hoisted(() => ({
  selectRegistry: new Map<string, { value: unknown; onValueChange?: (v: string) => void }>(),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children?: ReactNode; value?: unknown; onValueChange?: (v: string) => void }) => {
    const triggerId = Children.toArray(children)
      .map((c) => (c as { props?: { id?: string } })?.props?.id)
      .find((id): id is string => typeof id === "string")
    if (triggerId) selectRegistry.set(triggerId, { value, onValueChange })
    return createElement("div", { "data-select-id": triggerId }, children)
  },
  SelectContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  SelectItem: ({ children, value }: { children?: ReactNode; value?: string }) =>
    createElement("option", { value }, children),
  SelectTrigger: ({ children, id }: { children?: ReactNode; id?: string }) => createElement("div", { id }, children),
  SelectValue: () => createElement("span"),
}))

import { FrameFitFields, previewFrameDelivery, supportsReferenceDelivery } from "../frame-fit-fields"

function mount(over: Partial<Parameters<typeof FrameFitFields>[0]> = {}) {
  selectRegistry.clear()
  const onUpdate = vi.fn()
  const utils = render(
    <FrameFitFields
      provider="seedance-2-5"
      resolution="720p"
      aspectRatio="16:9"
      frameFit={undefined}
      frameDelivery={undefined}
      hasFrame
      onUpdate={onUpdate}
      {...over}
    />,
  )
  const optionText = (selectId: string, value: string) =>
    utils.container.querySelector(`[data-select-id="${selectId}"] option[value="${value}"]`)?.textContent ?? null
  return { ...utils, onUpdate, optionText }
}

describe("FrameFitFields", () => {
  it("renders nothing without a wired frame", () => {
    const { container } = mount({ hasFrame: false })
    expect(container.innerHTML).toBe("")
  })

  it("reads as the defaults when both values are unset", () => {
    mount()
    expect(selectRegistry.get("frameFit")?.value).toBe("resolution")
    expect(selectRegistry.get("frameDelivery")?.value).toBe("auto")
  })

  it("hides delivery on a model with no reference-image support", () => {
    expect(supportsReferenceDelivery("veo3")).toBe(false)
    const { container } = mount({ provider: "veo3", resolution: undefined, aspectRatio: undefined })
    expect(container.querySelector('[data-select-id="frameFit"]')).not.toBeNull()
    expect(container.querySelector('[data-select-id="frameDelivery"]')).toBeNull()
  })

  it("auto names reference delivery on the Seedance 2.0 family and frame delivery elsewhere", () => {
    const s2 = mount({ provider: "seedance-2" })
    expect(s2.optionText("frameDelivery", "auto")).toBe("Auto (as reference image)")
    s2.unmount()
    const s25 = mount({ provider: "seedance-2-5" })
    expect(s25.optionText("frameDelivery", "auto")).toBe("Auto (as frame)")
    s25.unmount()
    const h3 = mount({ provider: "minimax-h3", resolution: "768P", aspectRatio: "9:16" })
    expect(h3.optionText("frameDelivery", "auto")).toBe("Auto (as frame)")
  })

  it("shows the measured canvas only when the trio is measured and fit is the output size", () => {
    const measured = mount({ provider: "seedance-2-5", resolution: "720p", aspectRatio: "16:9" })
    expect(measured.getByText("Frames are fitted to 1280×720 before sending.")).toBeTruthy()
    measured.unmount()
    // 768P is upper-cased in the UI; the table is keyed lower-case. 768x1344 —
    // the row that justifies a measured table over arithmetic.
    const h3 = mount({ provider: "minimax-h3", resolution: "768P", aspectRatio: "9:16" })
    expect(h3.getByText("Frames are fitted to 768×1344 before sending.")).toBeTruthy()
    h3.unmount()
    const open = mount({ provider: "seedance-2-5", resolution: "720p", aspectRatio: "adaptive" })
    expect(open.queryByText(/Frames are fitted/)).toBeNull()
    open.unmount()
    const ratioOnly = mount({ provider: "seedance-2-5", resolution: "720p", aspectRatio: "16:9", frameFit: "ratio" })
    expect(ratioOnly.queryByText(/Frames are fitted/)).toBeNull()
  })

  it("writes the chosen values through onUpdate", () => {
    const { onUpdate } = mount()
    selectRegistry.get("frameFit")?.onValueChange?.("original")
    selectRegistry.get("frameDelivery")?.onValueChange?.("reference")
    expect(onUpdate).toHaveBeenCalledWith({ frameFit: "original" })
    expect(onUpdate).toHaveBeenCalledWith({ frameDelivery: "reference" })
  })

  it("prefixes element ids so two panels can mount it", () => {
    mount({ idPrefix: "gv-" })
    expect(selectRegistry.has("gv-frameFit")).toBe(true)
    expect(selectRegistry.has("gv-frameDelivery")).toBe(true)
  })
})

describe("previewFrameDelivery — mirror of lib/video-frame-dispatch.ts", () => {
  it("auto keeps frame delivery on a model outside the Seedance 2.0 family", () => {
    expect(previewFrameDelivery({ provider: "seedance-2-5", requested: undefined, hasStartFrame: true, hasEndFrame: false, userRefCount: 0 }))
      .toEqual({ delivery: "frame", promptSuffix: "" })
  })

  it("auto on seedance-2 binds the start frame as the first reference image", () => {
    expect(previewFrameDelivery({ provider: "seedance-2", requested: undefined, hasStartFrame: true, hasEndFrame: false, userRefCount: 0 }))
      .toEqual({ delivery: "reference", promptSuffix: "Use @image_1 as the opening (first) frame of the video." })
  })

  it("frames join AFTER the user's references and both frames get their own sentence", () => {
    expect(previewFrameDelivery({ provider: "seedance-2-fast", requested: "reference", hasStartFrame: true, hasEndFrame: true, userRefCount: 2 }))
      .toEqual({
        delivery: "reference",
        promptSuffix: "Use @image_3 as the opening (first) frame of the video. Use @image_4 as the closing (last) frame of the video.",
      })
  })

  it("skips the opening sentence when the prompt already binds its first frame", () => {
    const r = previewFrameDelivery({ provider: "seedance-2", requested: undefined, hasStartFrame: true, hasEndFrame: false, userRefCount: 0, prompt: "use @image_1 as the first frame, it is the last keyframe of @video_1" })
    expect(r).toEqual({ delivery: "reference", promptSuffix: "" })
  })

  it("does not re-route when nothing is wired, and never on a model without reference support", () => {
    expect(previewFrameDelivery({ provider: "seedance-2", requested: undefined, hasStartFrame: false, hasEndFrame: false, userRefCount: 0 }).delivery).toBe("frame")
    expect(previewFrameDelivery({ provider: "veo3", requested: "reference", hasStartFrame: true, hasEndFrame: false, userRefCount: 0 }).delivery).toBe("frame")
  })

  it("stays in frame mode when reference delivery would exceed the model's image cap", () => {
    // seedance-2 caps at 9 images: 8 user refs + 2 frames = 10.
    expect(previewFrameDelivery({ provider: "seedance-2", requested: "reference", hasStartFrame: true, hasEndFrame: true, userRefCount: 8 }).delivery).toBe("frame")
  })
})
