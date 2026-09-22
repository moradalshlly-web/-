import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The Add Captions node's own badge and hover Run pill quoted the generic
 * `ffmpeg` row (10) while every canvas run reserves 30 or 50 — a 5x under-quote
 * on the default node, and two prices for one node on one screen (the config
 * panel's Generate button already followed the renderer). The pill now reads the
 * SAME id `getModelIdentifier` gives the panel and the run estimate, so the two
 * cannot drift apart again.
 */

let storeState: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } = { nodes: [], edges: [] }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}))

const { useAddCaptionsCreditId } = await import("../use-add-captions-credit-id")
const { getModelIdentifier } = await import("@/components/editor/config-panels/helpers")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "json", targetHandle }) as unknown as WorkflowEdge

/** Renders the hook against a graph and returns the id it asks for, asserting
 *  on the way that the panel's estimator agrees with it for the same graph. */
function idFor(captions: WorkflowNode, edges: WorkflowEdge[] = [], others: WorkflowNode[] = []): string {
  storeState = { nodes: [captions, ...others], edges }
  const { result } = renderHook(() =>
    useAddCaptionsCreditId(captions.id, captions.data as Record<string, unknown>),
  )
  expect(result.current, "the badge and the panel must quote one row").toBe(
    getModelIdentifier(captions, edges, storeState.nodes),
  )
  return result.current
}

describe("useAddCaptionsCreditId", () => {
  beforeEach(() => {
    storeState = { nodes: [], edges: [] }
  })

  // The canvas node has no text field and only takes a video + a Transcript, so
  // the default node auto-transcribes: timed captions, Remotion, kinetic row.
  it("the default canvas node quotes the row its run reserves — never the ffmpeg row", () => {
    const id = idFor(node("ac", "add-captions", { style: "subtitle" }))
    expect(id).toBe("add-captions:kinetic")
    expect(id).not.toBe("ffmpeg")
  })

  it("a plain subtitle burning inline text stays on the cheap FFmpeg row", () => {
    expect(idFor(node("ac", "add-captions", { style: "subtitle", text: "Hello" }))).toBe("add-captions")
  })

  it("a styling lever moves it to the Remotion row", () => {
    expect(idFor(node("ac", "add-captions", { style: "subtitle", text: "Hello", positionY: 65 }))).toBe(
      "add-captions:kinetic",
    )
  })

  // Edge-aware: the wired source is what the run resolves, whatever the node
  // data says — the price has to follow the graph, not only the node.
  it("a Transcript wired into the transcript handle prices the Remotion row", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("t1", "ac", "transcript")], [node("t1", "apply-edl")])).toBe(
      "add-captions:kinetic",
    )
  })

  it("a transcribe node wired in on the default handle prices the Remotion row", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("t1", "ac", "in")], [node("t1", "transcribe")])).toBe("add-captions:kinetic")
  })

  it("an unrelated edge leaves the cheap row alone", () => {
    const captions = node("ac", "add-captions", { style: "subtitle", text: "Hello" })
    expect(idFor(captions, [edge("v1", "ac", "in")], [node("v1", "upload-video")])).toBe("add-captions")
  })
})

/**
 * Structural: the card must ASK for that id. The defect was a hardcoded model id
 * in the card itself, which no behavioural test of the hook can see.
 */
describe("the Add Captions card prices itself on the row the run reserves", () => {
  const source = readFileSync(join(__dirname, "..", "add-captions-node.tsx"), "utf8")

  it("reads the renderer-following id, not a hardcoded model", () => {
    expect(source).toMatch(/useAddCaptionsCreditId\(/)
    expect(source).not.toMatch(/useModelCredits\(\s*"[a-z]/)
  })
})
