// The Apply EDL card's empty state was the node's last raw-English surface: a
// hardcoded `Apply EDL → {output}`. No copy guard caught it, and the arrow points
// the wrong way under RTL. These lock it to the dict, per output medium, and to a
// LIVE language switch (the node is memo()-wrapped, so a t() call that isn't a
// hook subscription would freeze on the boot locale).
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: () => null,
  HANDLE_COLORS: { video: "#000", audio: "#000" },
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {}, runSingleNode: () => {} }),
}))
// The pill is `rate × minutes`: the core cost hook (react-query) and the minutes
// resolver (workflow store) are irrelevant to the copy under test.
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 10 }))
vi.mock("@/hooks/use-apply-edl-estimate-minutes", () => ({ useApplyEdlEstimateMinutes: () => 1 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))

import { ApplyEdlNode } from "../apply-edl-node"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

function renderNode(data: Record<string, unknown> = {}) {
  return render(
    <ApplyEdlNode {...({ id: "node-1", data: { label: "Apply EDL", ...data }, selected: false } as any)} />,
  )
}

describe("ApplyEdlNode empty-state copy comes from the dict", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("names the video render by default, with no raw arrow expression", () => {
    renderNode()
    expect(screen.getByText(translate("en", "node.applyEdlConnectVideo"))).toBeTruthy()
    expect(screen.queryByText(/Apply EDL\s*→/)).toBeNull()
  })

  it("names the audio render when the output medium is audio", () => {
    renderNode({ output: "audio" })
    expect(screen.getByText(translate("en", "node.applyEdlConnectAudio"))).toBeTruthy()
  })

  it("renders Hebrew — and only Hebrew — under the he locale, switching LIVE", () => {
    renderNode()
    act(() => useLocaleStore.getState().setLocale("he"))
    const he = translate("he", "node.applyEdlConnectVideo")
    expect(he).not.toBe(translate("en", "node.applyEdlConnectVideo"))
    expect(screen.getByText(he)).toBeTruthy()
    expect(screen.queryByText(translate("en", "node.applyEdlConnectVideo"))).toBeNull()
    // RTL-safe: a directional arrow in a translated string reads backwards.
    expect(he).not.toMatch(/[→←]/)
  })

  it("both medium keys exist in en AND he (a missing he key silently falls back to English)", () => {
    for (const key of ["node.applyEdlConnectVideo", "node.applyEdlConnectAudio"] as const) {
      expect(translate("he", key)).not.toBe(translate("en", key))
      expect(translate("en", key)).not.toBe(key)
    }
  })
})
