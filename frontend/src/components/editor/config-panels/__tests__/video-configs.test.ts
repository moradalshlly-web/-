import { describe, it, expect, vi } from "vitest"
import { Children, createElement, type ReactNode } from "react"
import { render } from "@testing-library/react"

// The GVP panel block below renders the REAL GenerateVideoProConfig. Two
// module-level mocks make that possible without a router/query provider tree
// (the prompt-snippet hook reaches useAuth -> useNavigate) and make Radix's
// portal-mounted Select observable in jsdom: every `<Select>` registers its
// (value, onValueChange) under its trigger id, and items render inline as
// <option> so their labels land in the DOM. Everything else — including the
// select module's other exports — stays real.
const { selectRegistry } = vi.hoisted(() => ({
  selectRegistry: new Map<string, { value: unknown; onValueChange?: (v: string) => void }>(),
}))

vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({
  useSnippetPool: () => [],
}))

vi.mock("@/components/ui/select", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

import {
  buildVideoRefAutocomplete,
  toRefImageItems,
  buildVideoRefVideoAutocomplete,
  buildVideoRefAudioAutocomplete,
  GenerateVideoProConfig,
} from "../video-configs"
import {
  buildImageConnectedReferences,
  connectedReferencesToRefImages,
  type ConnectedRefsData,
} from "../connected-references"
import { FramesAndReferencesTip } from "../frames-references-tip"
import type { SourceNodeInfo } from "../types"

function imgSource(
  id: string,
  targetHandle: string,
  url: string,
  type = "upload-image",
): SourceNodeInfo {
  return { id, type, label: id, value: "", targetHandle, nodeData: { url } }
}

/** A source wired into a reference-VIDEO / reference-AUDIO handle. The handle id
 *  is what `referenceModalityForHandle` keys off of (legacy `reference-videos` /
 *  `reference-audio` AND the canonical `videoReferences` / `audioReferences`). */
function mediaSource(
  id: string,
  targetHandle: string,
  url: string,
  type = "generate-video",
): SourceNodeInfo {
  return { id, type, label: id, value: "", targetHandle, nodeData: { url } }
}

describe("video-configs {image:N} numbering — reference-handle images only", () => {
  // Backend `reference_image_urls` lists reference-handle images first and
  // appends the start/end frame at the TAIL. The editor's `{image:N}` token
  // must therefore number the `references` handle images ONLY — the start
  // frame must NOT consume slot 1 (that desyncs editor token N from backend
  // reference slot N).
  it("numbers the two reference images 1 and 2 and excludes the start frame", () => {
    const sources: SourceNodeInfo[] = [
      // Start frame deliberately FIRST so the buggy `i + 1` numbering would
      // hand it index 1 and bump the references to 2/3.
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("ref2", "references", "https://r2/ref2.png", "generate-image"),
    ]

    const items = toRefImageItems(buildVideoRefAutocomplete(sources))

    // Start frame is not a reference → no {image:N} item at all.
    expect(items.find((i) => i.url === "https://r2/start.png")).toBeUndefined()

    // The two references are numbered 1 and 2, matching backend slot order.
    expect(items.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(items.find((i) => i.url === "https://r2/ref2.png")?.index).toBe(2)
    expect(items).toHaveLength(2)
  })

  it("excludes an end frame and keeps reference numbering 1-based", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("endFrame", "endFrame", "https://r2/end.png"),
    ]
    const items = toRefImageItems(buildVideoRefAutocomplete(sources))
    expect(items.find((i) => i.url === "https://r2/end.png")).toBeUndefined()
    expect(items.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(items).toHaveLength(1)
  })

  it("leaves reference numbering intact when no frame is wired", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("ref2", "references", "https://r2/ref2.png"),
    ]
    const items = toRefImageItems(buildVideoRefAutocomplete(sources))
    expect(items.map((i) => i.index)).toEqual([1, 2])
  })
})

describe("video-configs {video:N} / {audio:N} reference numbering", () => {
  // Independent positional numbering per modality — a wired reference VIDEO is
  // `{video:N}` (N counting video handles only), a wired reference AUDIO is
  // `{audio:N}` (N counting audio handles only). Both start at 1 and ignore
  // each other AND the image-reference handles, so the editor token N maps 1:1
  // to the backend `referenceVideoUrls` / `referenceAudioUrls` slot N (counted
  // the same way via the shared `referenceModalityForHandle`).
  it("numbers two wired reference VIDEOS 1 and 2 (source 'video'), both legacy + canonical handle ids", () => {
    const sources: SourceNodeInfo[] = [
      mediaSource("v1", "videoReferences", "https://r2/v1.mp4"),
      mediaSource("v2", "reference-videos", "https://r2/v2.mp4"),
    ]
    const items = buildVideoRefVideoAutocomplete(sources)
    expect(items.map((i) => i.index)).toEqual([1, 2])
    expect(items.every((i) => i.source === "video")).toBe(true)
    expect(items.map((i) => i.url)).toEqual(["https://r2/v1.mp4", "https://r2/v2.mp4"])
  })

  it("numbers reference AUDIO independently of video and ignores image/frame handles", () => {
    const sources: SourceNodeInfo[] = [
      mediaSource("v1", "videoReferences", "https://r2/v1.mp4"),
      mediaSource("a1", "audioReferences", "https://r2/a1.mp3"),
      mediaSource("a2", "reference-audio", "https://r2/a2.mp3"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("frame", "startFrame", "https://r2/start.png"),
    ]
    const audio = buildVideoRefAudioAutocomplete(sources)
    expect(audio.map((i) => i.index)).toEqual([1, 2])
    expect(audio.every((i) => i.source === "audio")).toBe(true)
    // Video numbering is independent — it sees only the single video handle.
    expect(buildVideoRefVideoAutocomplete(sources).map((i) => i.index)).toEqual([1])
  })

  it("returns nothing when only frames / image refs are wired (no video/audio handles)", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
    ]
    expect(buildVideoRefVideoAutocomplete(sources)).toHaveLength(0)
    expect(buildVideoRefAudioAutocomplete(sources)).toHaveLength(0)
  })
})

describe("cross-surface {image:N} numbering parity — config panel vs inline/modal", () => {
  // INVARIANT-2 guard (the C1 regression): editor `{image:N}` numbering has ONE
  // authority across surfaces. The config panel builds it via
  // `toRefImageItems(buildVideoRefAutocomplete(...))`; the inline canvas editor +
  // quick-edit modal build it via
  // `connectedReferencesToRefImages(buildImageConnectedReferences(...))`. Both
  // MUST exclude start/end frames and number the SAME reference image the SAME
  // way — otherwise the inline editor offers a token whose N is out-of-range at
  // the backend (`countRefModalityEdges` excludes frames) → the reference binding
  // is silently dropped on a paid run (the canonical i2v-with-frame scenario).

  /** The inline/modal surface's `{image:N}` items for the given wired sources. */
  function inlineImageItems(sources: SourceNodeInfo[]) {
    return connectedReferencesToRefImages(
      buildImageConnectedReferences({
        data: {} as ConnectedRefsData,
        sources,
        nodes: [],
        attachedChars: [],
      }),
    )
  }
  /** The config-panel surface's `{image:N}` items for the same sources. */
  function configImageItems(sources: SourceNodeInfo[]) {
    return toRefImageItems(buildVideoRefAutocomplete(sources))
  }

  it("a start frame + one reference image: BOTH number the reference 1, NEITHER offers a {image:N} for the frame", () => {
    // Start frame deliberately FIRST (the natural add order) so the pre-fix
    // frame-blind `i + 1` numbering would have handed the frame index 1 and the
    // reference index 2 on the inline/modal surface.
    const sources: SourceNodeInfo[] = [
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "imageReferences", "https://r2/ref1.png"),
    ]

    const cfg = configImageItems(sources)
    const inl = inlineImageItems(sources)

    // Neither surface offers a {image:N} item for the frame.
    expect(cfg.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
    expect(inl.find((i) => i.url === "https://r2/start.png")).toBeUndefined()

    // Both surfaces number the reference 1 — identical numbering.
    expect(cfg.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(inl.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)

    // One numbered reference each (the frame is gone, not just renumbered).
    expect(cfg).toHaveLength(1)
    expect(inl).toHaveLength(1)
  })

  it("two reference images around a frame: BOTH number 1,2 identically and exclude the frame", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref2", "imageReferences", "https://r2/ref2.png"),
    ]

    const cfg = configImageItems(sources)
    const inl = inlineImageItems(sources)

    // Identical {url → index} numbering across both surfaces, frame excluded.
    const numbering = (items: ReturnType<typeof configImageItems>) =>
      items.map((i) => `${i.url}#${i.index}`)
    expect(numbering(inl)).toEqual(numbering(cfg))
    expect(cfg.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(cfg.find((i) => i.url === "https://r2/ref2.png")?.index).toBe(2)
    expect(cfg.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
    expect(inl.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
  })
})

describe("FramesAndReferencesTip", () => {
  it("renders the approximation note only when BOTH a frame and a reference are present", () => {
    const { container, rerender } = render(
      createElement(FramesAndReferencesTip, { hasFrame: true, hasReference: true }),
    )
    expect(container.textContent).toMatch(/approximated via the prompt/i)

    rerender(createElement(FramesAndReferencesTip, { hasFrame: true, hasReference: false }))
    expect(container).toBeEmptyDOMElement()

    rerender(createElement(FramesAndReferencesTip, { hasFrame: false, hasReference: true }))
    expect(container).toBeEmptyDOMElement()

    rerender(createElement(FramesAndReferencesTip, { hasFrame: false, hasReference: false }))
    expect(container).toBeEmptyDOMElement()
  })
})

// =============================================================================
// GenerateVideoProConfig — render method toggle (keyframes, 2026-08-03)
// =============================================================================

const RENDER_METHOD_ID = "gvp-render-method"

function renderGvp(data: Record<string, unknown> = {}) {
  selectRegistry.clear()
  const onUpdate = vi.fn()
  const view = render(
    createElement(GenerateVideoProConfig as never, {
      data: { label: "Generate Video Pro", provider: "seedance-2", duration: 8, ...data },
      onUpdate,
      sources: [],
      fieldMappings: {},
      onMapField: vi.fn(),
      nodes: [],
    }),
  )
  return { ...view, onUpdate, select: () => selectRegistry.get(RENDER_METHOD_ID) }
}

describe("GenerateVideoProConfig — render method", () => {
  it("offers both methods with their labels and the post-render music caption", () => {
    const { container } = renderGvp()
    expect(container.textContent).toContain("Render method")
    expect(container.textContent).toContain("Extend (video chain)")
    expect(container.textContent).toContain("Keyframes (scene anchors)")
    expect(container.textContent).toContain(
      "Keyframes renders each scene from generated start/end frames — scenes re-render independently. Music is added after render, not by the video model.",
    )
  })

  it("defaults to extend when the node carries no renderMethod", () => {
    const { select, onUpdate } = renderGvp()
    expect(select()?.value).toBe("extend")
    // Purely presentational default — nothing is written back on mount, so an
    // untouched node stays byte-identical on the wire.
    expect(onUpdate.mock.calls.flatMap(([u]) => Object.keys(u as object))).not.toContain("renderMethod")
  })

  it("reflects a persisted keyframes selection", () => {
    const { select } = renderGvp({ renderMethod: "keyframes" })
    expect(select()?.value).toBe("keyframes")
  })

  it("writes keyframes on selection and writes extend back explicitly", () => {
    const { select, onUpdate } = renderGvp()
    select()?.onValueChange?.("keyframes")
    expect(onUpdate).toHaveBeenLastCalledWith({ renderMethod: "keyframes" })

    const back = renderGvp({ renderMethod: "keyframes" })
    back.select()?.onValueChange?.("extend")
    // "extend" is written explicitly rather than cleared to undefined — the
    // store merges by spread and never deletes keys; the payload builder only
    // puts the field on the wire when it is exactly "keyframes".
    expect(back.onUpdate).toHaveBeenLastCalledWith({ renderMethod: "extend" })
  })
})

// =============================================================================
// GenerateVideoProConfig — anchor frames (keyframes anchor mode)
// =============================================================================

const ANCHOR_MODE_ID = "gvp-anchor-mode"

function renderAnchor(data: Record<string, unknown> = {}, sources: SourceNodeInfo[] = []) {
  selectRegistry.clear()
  const onUpdate = vi.fn()
  const view = render(
    createElement(GenerateVideoProConfig as never, {
      data: { label: "Generate Video Pro", provider: "seedance-2", duration: 8, renderMethod: "keyframes", ...data },
      onUpdate,
      sources,
      fieldMappings: {},
      onMapField: vi.fn(),
      nodes: [],
    }),
  )
  return { ...view, onUpdate, select: () => selectRegistry.get(ANCHOR_MODE_ID) }
}

const END_FRAME_SOURCE = [imgSource("end-1", "endFrame", "https://r2/end.png")]

describe("GenerateVideoProConfig — anchor frames", () => {
  it("offers every anchor choice under the keyframes method", () => {
    const { container } = renderAnchor()
    expect(container.textContent).toContain("Anchor frames")
    for (const label of ["Auto (engine decides)", "Start + end frames", "Start frame only", "References only"]) {
      expect(container.textContent, label).toContain(label)
    }
  })

  it("hides the control on an extend run, where there are no anchors to choose", () => {
    const { container } = renderAnchor({ renderMethod: "extend" })
    expect(container.textContent).not.toContain("Anchor frames")
    expect(selectRegistry.get(ANCHOR_MODE_ID)).toBeUndefined()
  })

  it("shows the control on a keyframes-only provider with no explicit render method", () => {
    // veo3 has no reference-video transport, so it always renders keyframes —
    // the panel must offer the anchor lever there even though the node never
    // stored a renderMethod of its own.
    const { container } = renderAnchor({ provider: "veo3", renderMethod: undefined })
    expect(container.textContent).toContain("Anchor frames")
  })

  it("defaults to auto without writing anything back on mount", () => {
    const { select, onUpdate } = renderAnchor()
    expect(select()?.value).toBe("auto")
    // Presentational default only — an untouched node must stay byte-identical
    // on the wire, exactly as the render-method select behaves.
    expect(onUpdate.mock.calls.flatMap(([u]) => Object.keys(u as object))).not.toContain("anchorMode")
  })

  it("reflects a persisted choice and writes the picked one back", () => {
    expect(renderAnchor({ anchorMode: "reference" }).select()?.value).toBe("reference")

    const { select, onUpdate } = renderAnchor()
    select()?.onValueChange?.("start-only")
    expect(onUpdate).toHaveBeenLastCalledWith({ anchorMode: "start-only" })
  })

  it("explains what each choice does, including the drift start-only removes", () => {
    expect(renderAnchor({ anchorMode: "start-only" }).container.textContent).toContain(
      "previous shot's real last frame",
    )
    expect(renderAnchor({ anchorMode: "reference" }).container.textContent).toContain(
      "No generated frames at all",
    )
  })

  // The engine rejects a reference-only run carrying a wired closing frame
  // ("endFrameUrl cannot ride anchorMode \"none\""), which would otherwise be a
  // 400 on every run of a perfectly reasonable-looking node.
  it("drops References only while an end frame is wired, and says why", () => {
    const { container } = renderAnchor({}, END_FRAME_SOURCE)
    expect(container.textContent).toContain("Anchor frames")
    expect(container.textContent).toContain("Start frame only")
    expect(container.textContent).not.toContain("References only")
    expect(container.textContent).toContain("no closing-frame lane")
  })

  it("keeps every choice when no end frame is wired", () => {
    const { container } = renderAnchor({}, [imgSource("start-1", "startFrame", "https://r2/start.png")])
    expect(container.textContent).toContain("References only")
    expect(container.textContent).not.toContain("no closing-frame lane")
  })

  it("snaps a stored reference choice back to auto when an end frame is wired", () => {
    // Hiding the option only protects a node configured after the edge exists;
    // one already set to "reference" would keep the value while the dropdown
    // stopped showing it, then fail at run time.
    const { onUpdate } = renderAnchor({ anchorMode: "reference" }, END_FRAME_SOURCE)
    expect(onUpdate).toHaveBeenCalledWith({ anchorMode: "auto" })
  })

  it("leaves the other choices alone when an end frame is wired", () => {
    for (const anchorMode of ["auto", "start-end", "start-only"]) {
      const { onUpdate } = renderAnchor({ anchorMode }, END_FRAME_SOURCE)
      expect(
        onUpdate.mock.calls.flatMap(([u]) => Object.keys(u as object)),
        anchorMode,
      ).not.toContain("anchorMode")
    }
  })
})


describe("Video Pro continuity control availability", () => {
  it("keeps best-pair windows for Keyframes but hides Extend-only controls", () => {
    const { container } = renderGvp({ renderMethod: "keyframes", segmentMode: "short", rollingRefs: true, audioTail: true, overlapAnchor: true, overlapAnchorMode: "last-frame" })
    for (const id of ["gvp-context-tail", "gvp-rollingRefs", "gvp-audioTail", "gvp-overlap-anchor", "gvp-wordCut"]) {
      expect(container.querySelector(`#${id}`), id).toBeNull()
    }
    for (const id of ["gvp-smart-cut", "gvp-smartCutFramesPrev", "gvp-smartCutFramesNext"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
    expect(container.textContent).toContain("intentional cuts stay intact")
  })

  it("offers Extend controls and hides audio context when generation is silent", () => {
    const { container } = renderGvp({ renderMethod: "extend", segmentMode: "max", generateAudio: false })
    expect(container.querySelector("#gvp-rollingRefs")).not.toBeNull()
    expect(container.querySelector("#gvp-overlap-anchor")).not.toBeNull()
    expect(container.querySelector("#gvp-audioTail")).toBeNull()
    expect(renderGvp({ renderMethod: "extend", generateAudio: true }).container.querySelector("#gvp-audioTail")).not.toBeNull()
  })

  it("normalizes a stored pre-roll choice when switching to Keyframes", () => {
    const { onUpdate } = renderGvp({ renderMethod: "keyframes", smartCutMode: "preroll-keep-prev" })
    expect(selectRegistry.get("gvp-smart-cut")?.value).toBe("legacy-8x8")
    expect(onUpdate).toHaveBeenCalledWith({ smartCutMode: "legacy-8x8" })
  })
})
