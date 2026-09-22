import { describe, it, expect } from "vitest"
import { buildFeedMaps, nodeFeedsAnything } from "../trigger-feeds.js"

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra })
const edge = (source: string, target: string) => ({ source, target })

describe("buildFeedMaps — every way one node feeds another", () => {
  it("a drawn edge feeds; an edge whose end left the graph feeds nothing; a self-loop feeds nothing", () => {
    const { children, parents } = buildFeedMaps([node("a"), node("b")], [edge("a", "b"), edge("a", "gone"), edge("gone", "b"), edge("b", "b")])
    expect(children.get("a")).toEqual(["b"])
    expect(children.get("b")).toBeUndefined()
    expect(parents.get("b")).toEqual(["a"])
    expect(children.has("gone")).toBe(false)
  })

  it("a node inside a Group feeds the group", () => {
    const { children } = buildFeedMaps([node("img", { parentId: "G" }), node("G")], [])
    expect(children.get("img")).toEqual(["G"])
  })

  it("a field mapping feeds its node by sourceNodeId, even with no edge", () => {
    const { children, parents } = buildFeedMaps(
      [node("style"), node("img", { data: { fieldMappings: { prompt: { sourceNodeId: "style" }, seed: { sourceNodeId: "gone" } } } })],
      [],
    )
    expect(children.get("style")).toEqual(["img"])
    expect(parents.get("img")).toEqual(["style"])
  })
})

describe("nodeFeedsAnything — the editor's 'is this trigger wired?'", () => {
  it("agrees with the maps in both directions", () => {
    const nodes = [node("sched"), node("img"), node("G"), node("member", { parentId: "G" })]
    expect(nodeFeedsAnything(nodes, [edge("sched", "img")], "sched")).toBe(true)
    expect(nodeFeedsAnything(nodes, [edge("sched", "gone")], "sched")).toBe(false)
    expect(nodeFeedsAnything(nodes, [], "member")).toBe(true)
    expect(nodeFeedsAnything(nodes, [], "sched")).toBe(false)
  })
})
