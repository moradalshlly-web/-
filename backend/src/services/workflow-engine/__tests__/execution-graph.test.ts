import { describe, it, expect } from "vitest"
import {
  triggerRunScope,
  buildExecutionLevels,
  getEffectivelySkippedIds,
  isSourceNode,
  isSkipNode,
  getUploadDescendantIds,
  IMAGE_SOURCE_TYPES,
  VIDEO_SOURCE_TYPES,
  AUDIO_SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
} from "../execution-graph.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

function node(id: string, type = "generate-image", data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
}

describe("buildExecutionLevels", () => {
  it("returns empty array for empty graph", () => {
    expect(buildExecutionLevels([], [])).toEqual([])
  })

  it("puts all independent nodes in one level", () => {
    const levels = buildExecutionLevels([node("a"), node("b"), node("c")], [])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toHaveLength(3)
  })

  it("builds correct levels for linear chain A -> B -> C", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "b"), edge("b", "c")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(3)
    expect(levels[0].map((n) => n.id)).toEqual(["a"])
    expect(levels[1].map((n) => n.id)).toEqual(["b"])
    expect(levels[2].map((n) => n.id)).toEqual(["c"])
  })

  it("builds correct levels for diamond DAG", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")]
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(3)
    expect(levels[0].map((n) => n.id)).toEqual(["a"])
    expect(levels[1].map((n) => n.id).sort()).toEqual(["b", "c"])
    expect(levels[2].map((n) => n.id)).toEqual(["d"])
  })

  it("ignores edges with missing source or target nodes", () => {
    const nodes = [node("a"), node("b")]
    const edges = [edge("a", "b"), edge("a", "missing"), edge("missing", "b")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(2)
  })

  it("handles disconnected subgraphs", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")]
    const edges = [edge("a", "b"), edge("c", "d")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(2)
    expect(levels[0].map((n) => n.id).sort()).toEqual(["a", "c"])
    expect(levels[1].map((n) => n.id).sort()).toEqual(["b", "d"])
  })

  it("promotes nodes when preResolvedNodeIds skips their dependency edges", () => {
    const nodes = [node("source"), node("a"), node("b")]
    const edges = [edge("source", "a"), edge("source", "b")]
    const preResolved = new Set(["source"])
    const levels = buildExecutionLevels(nodes, edges, preResolved)
    expect(levels).toHaveLength(1)
    const ids = levels[0].map((n) => n.id).sort()
    expect(ids).toContain("a")
    expect(ids).toContain("b")
  })

  it("partially promotes when some deps are pre-resolved", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "c"), edge("b", "c")]
    const preResolved = new Set(["a"])
    const levels = buildExecutionLevels(nodes, edges, preResolved)
    expect(levels).toHaveLength(2)
    expect(levels[0].map((n) => n.id).sort()).toEqual(["a", "b"])
    expect(levels[1].map((n) => n.id)).toEqual(["c"])
  })

  it("deduplicates children in same level", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "c"), edge("b", "c")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels[1].map((n) => n.id)).toEqual(["c"])
  })

  it("handles single node", () => {
    const levels = buildExecutionLevels([node("a")], [])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toHaveLength(1)
  })
})

describe("getEffectivelySkippedIds", () => {
  it("returns empty set for no skipped nodes", () => {
    expect(getEffectivelySkippedIds([node("a"), node("b")], []).size).toBe(0)
  })

  it("returns only directly-skipped node IDs", () => {
    const nodes = [
      node("a", "generate-image", { skipped: true }),
      node("b"),
      node("c", "generate-image", { skipped: true }),
    ]
    const result = getEffectivelySkippedIds(nodes, [])
    expect(result.size).toBe(2)
    expect(result.has("a")).toBe(true)
    expect(result.has("c")).toBe(true)
    expect(result.has("b")).toBe(false)
  })

  it("treats falsy skipped value as not skipped", () => {
    const nodes = [
      node("a", "generate-image", { skipped: false }),
      node("b", "generate-image", { skipped: undefined }),
    ]
    expect(getEffectivelySkippedIds(nodes, []).size).toBe(0)
  })
})

describe("isSourceNode", () => {
  it("returns true for all source node types", () => {
    for (const t of ["text-prompt", "upload-image", "upload-video", "upload-audio", "youtube-video", "reference-audio", "list", "webhook-trigger", "schedule-trigger", "sub-workflow-input"]) {
      expect(isSourceNode(t)).toBe(true)
    }
  })

  it("returns false for non-source types", () => {
    expect(isSourceNode("generate-image")).toBe(false)
    expect(isSourceNode("combine-text")).toBe(false)
    // creature is EXECUTABLE (generates its image like object/character/location).
    // It must NOT be a source node — that would make isSourceNode() true and the
    // orchestrator would skip enqueuing the generate-creature job.
    expect(isSourceNode("creature")).toBe(false)
  })
})

describe("isSkipNode", () => {
  it("returns true for skip types", () => {
    expect(isSkipNode("manual-edit")).toBe(true)
    expect(isSkipNode("sub-workflow-output")).toBe(true)
  })

  it("returns false for non-skip types", () => {
    expect(isSkipNode("generate-image")).toBe(false)
  })
})

describe("getUploadDescendantIds", () => {
  it("returns empty set when no upload nodes", () => {
    const result = getUploadDescendantIds([node("a"), node("b")], [edge("a", "b")])
    expect(result.size).toBe(0)
  })

  it("finds direct descendants", () => {
    const nodes = [node("u1", "upload-image"), node("gen1")]
    const result = getUploadDescendantIds(nodes, [edge("u1", "gen1")])
    expect(result.has("gen1")).toBe(true)
    expect(result.has("u1")).toBe(false)
  })

  it("finds transitive descendants", () => {
    const nodes = [node("u1", "upload-video"), node("a"), node("b"), node("c")]
    const edges = [edge("u1", "a"), edge("a", "b"), edge("b", "c")]
    const result = getUploadDescendantIds(nodes, edges)
    expect(result.has("a")).toBe(true)
    expect(result.has("b")).toBe(true)
    expect(result.has("c")).toBe(true)
  })

  it("handles cycles without infinite loop", () => {
    const nodes = [node("u1", "upload-image"), node("a"), node("b")]
    const edges = [edge("u1", "a"), edge("a", "b"), edge("b", "a")]
    const result = getUploadDescendantIds(nodes, edges)
    expect(result.has("a")).toBe(true)
    expect(result.has("b")).toBe(true)
  })

  it("handles all upload types", () => {
    for (const t of ["upload-image", "upload-video", "upload-audio"]) {
      const result = getUploadDescendantIds([node("u", t), node("c")], [edge("u", "c")])
      expect(result.has("c")).toBe(true)
    }
  })
})

describe("media type sets", () => {
  it("IMAGE_SOURCE_TYPES includes key types", () => {
    expect(IMAGE_SOURCE_TYPES.has("generate-image")).toBe(true)
    expect(IMAGE_SOURCE_TYPES.has("upload-image")).toBe(true)
    expect(IMAGE_SOURCE_TYPES.has("scene")).toBe(true)
    // creature emits an image and must be treated as an image source feeding
    // downstream image/video generation (mirrors object/character/location).
    expect(IMAGE_SOURCE_TYPES.has("creature")).toBe(true)
  })

  it("VIDEO_SOURCE_TYPES includes key types", () => {
    expect(VIDEO_SOURCE_TYPES.has("image-to-video")).toBe(true)
    expect(VIDEO_SOURCE_TYPES.has("render-video")).toBe(true)
    expect(VIDEO_SOURCE_TYPES.has("combine-videos")).toBe(true)
  })

  it("VIDEO_SOURCE_TYPES includes generate-video", () => {
    // Unified video node — must be classified as a video source so
    // getPrimaryOutput returns output.videoUrl for it. Without this, downstream
    // video consumers (combine-videos, lip-sync, etc.) silently see no input
    // when reading from a generate-video upstream.
    expect(VIDEO_SOURCE_TYPES.has("generate-video")).toBe(true)
  })

  it("AUDIO_SOURCE_TYPES includes key types", () => {
    expect(AUDIO_SOURCE_TYPES.has("text-to-speech")).toBe(true)
    expect(AUDIO_SOURCE_TYPES.has("generate-music")).toBe(true)
  })

  it("TEXT_SOURCE_TYPES includes key types", () => {
    expect(TEXT_SOURCE_TYPES.has("text-prompt")).toBe(true)
    expect(TEXT_SOURCE_TYPES.has("ai-writer")).toBe(true)
    expect(TEXT_SOURCE_TYPES.has("list")).toBe(true)
  })
})

describe("triggerRunScope — what a triggered run executes", () => {
  const graph = () => {
    const nodes = [
      node("sched", "schedule-trigger"),
      node("text", "text-prompt"),
      node("img"),
      node("side-img"),
      node("vid", "image-to-video"),
      node("other-text", "text-prompt"),
      node("other-img"),
    ]
    const edges = [
      edge("sched", "text"),
      edge("text", "img"),
      edge("img", "vid"),
      edge("side-img", "vid"), // a node the branch NEEDS, off to the side of the trigger
      edge("other-text", "other-img"), // a branch the trigger does not reach
    ]
    return { nodes, edges }
  }

  it("a wired trigger runs its branch and everything that branch needs — nothing else", () => {
    const { nodes, edges } = graph()
    const scope = triggerRunScope(nodes, edges, { triggerType: "schedule", triggerNodeId: "sched" })
    expect(scope && [...scope].sort()).toEqual(["img", "sched", "side-img", "text", "vid"])
  })

  it("a trigger wired to nothing runs the whole workflow", () => {
    const { nodes } = graph()
    expect(triggerRunScope(nodes, [edge("other-text", "other-img")], { triggerType: "schedule", triggerNodeId: "sched" })).toBeNull()
  })

  it("a row that names no node falls back to the ONLY node of its lane's type; two such nodes mean the whole workflow", () => {
    const { nodes, edges } = graph()
    expect(triggerRunScope(nodes, edges, { triggerType: "schedule" })?.has("sched")).toBe(true)
    const two = [...nodes, node("sched-2", "schedule-trigger")]
    expect(triggerRunScope(two, [...edges, edge("sched-2", "other-text")], { triggerType: "schedule" })).toBeNull()
  })

  it("a named node that is no longer on the graph falls back the same way", () => {
    const { nodes, edges } = graph()
    expect(triggerRunScope(nodes, edges, { triggerType: "schedule", triggerNodeId: "gone" })?.has("sched")).toBe(true)
  })

  it("manual, API and app runs are never scoped by a trigger", () => {
    const { nodes, edges } = graph()
    expect(triggerRunScope(nodes, edges, { triggerType: "manual", triggerNodeId: "sched" })).toBeNull()
    expect(triggerRunScope(nodes, edges, { triggerType: "api" })).toBeNull()
    expect(triggerRunScope(nodes, edges, { triggerType: "app_run" })).toBeNull()
  })

  it("a named node of the WRONG type is not the trigger — the lane falls back to its own type", () => {
    // Node ids are re-minted per workflow; a delete + re-add can alias a row's
    // stored node id onto an unrelated node.
    const nodes = [node("sched", "schedule-trigger"), node("n1"), node("n2")]
    const edges = [edge("sched", "n1"), edge("n1", "n2")]
    const scope = triggerRunScope(nodes, edges, { triggerType: "schedule", triggerNodeId: "n2" })
    expect(scope && [...scope].sort()).toEqual(["n1", "n2", "sched"])
  })

  it("webhook and telegram lanes start from their own node types", () => {
    const nodes = [node("hook", "webhook-trigger"), node("tg", "telegram-trigger"), node("a"), node("b")]
    const edges = [edge("hook", "a"), edge("tg", "b")]
    const hook = triggerRunScope(nodes, edges, { triggerType: "webhook" })
    const tg = triggerRunScope(nodes, edges, { triggerType: "telegram" })
    expect(hook && [...hook].sort()).toEqual(["a", "hook"])
    expect(tg && [...tg].sort()).toEqual(["b", "tg"])
  })

  it("a cycle behind the trigger terminates, and the trigger is always in its own scope", () => {
    const nodes = [node("sched", "schedule-trigger"), node("a"), node("b")]
    const edges = [edge("sched", "a"), edge("a", "b"), edge("b", "a")]
    const scope = triggerRunScope(nodes, edges, { triggerType: "schedule" })
    expect(scope && [...scope].sort()).toEqual(["a", "b", "sched"])
    expect(scope?.has("sched")).toBe(true)
  })

  it("an edge whose end is gone from the graph feeds nothing — a trigger wired only to a deleted node runs the whole workflow", () => {
    // A delta that deletes a node leaves its edges behind; counting the
    // phantom target would scope the run to {trigger, phantom} and execute
    // nothing, silently, forever.
    const nodes = [node("sched", "schedule-trigger"), node("a"), node("b")]
    expect(triggerRunScope(nodes, [edge("sched", "gone"), edge("a", "b")], { triggerType: "schedule" })).toBeNull()
    // ...and a phantom edge beside a real one never enters the scope.
    const scope = triggerRunScope(nodes, [edge("sched", "a"), edge("gone", "a"), edge("a", "gone")], { triggerType: "schedule" })
    expect(scope && [...scope].sort()).toEqual(["a", "sched"])
  })

  it("a node inside a Group feeds the group (parentId, no edge) — the group and what follows it are in scope", () => {
    const nodes = [
      node("sched", "schedule-trigger"),
      { ...node("img1"), parentId: "G" },
      { ...node("img2"), parentId: "G" },
      node("G", "group"),
      node("best", "choose-best"),
      node("other"),
    ]
    const edges = [edge("sched", "img1"), edge("sched", "img2"), edge("G", "best")]
    const scope = triggerRunScope(nodes, edges, { triggerType: "schedule" })
    expect(scope && [...scope].sort()).toEqual(["G", "best", "img1", "img2", "sched"])
    // The other direction too: a trigger feeding the group pulls its members in as ancestors.
    const viaGroup = triggerRunScope(
      [node("sched", "schedule-trigger"), { ...node("m1"), parentId: "G" }, node("G", "group"), node("after")],
      [edge("sched", "G"), edge("G", "after")],
      { triggerType: "schedule" },
    )
    expect(viaGroup && [...viaGroup].sort()).toEqual(["G", "after", "m1", "sched"])
  })

  it("a field mapping feeds its node by sourceNodeId even without the edge it was made from", () => {
    const nodes = [
      node("sched", "schedule-trigger"),
      node("style", "text-prompt"),
      node("img", "generate-image", { fieldMappings: { prompt: { sourceNodeId: "style", sourceField: "text" } } }),
      node("other"),
    ]
    const scope = triggerRunScope(nodes, [edge("sched", "img")], { triggerType: "schedule" })
    expect(scope && [...scope].sort()).toEqual(["img", "sched", "style"])
    // A mapping to a node that is gone is ignored like a dangling edge.
    const dangling = triggerRunScope(
      [node("sched", "schedule-trigger"), node("img", "generate-image", { fieldMappings: { prompt: { sourceNodeId: "gone" } } })],
      [edge("sched", "img")],
      { triggerType: "schedule" },
    )
    expect(dangling && [...dangling].sort()).toEqual(["img", "sched"])
  })

  it("field and reference edges are walked like any other edge", () => {
    const nodes = [node("sched", "schedule-trigger"), node("img"), node("ref", "text-prompt")]
    const edges = [
      edge("sched", "img"),
      { ...edge("ref", "img"), sourceHandle: "text", targetHandle: "field-prompt" },
    ]
    const scope = triggerRunScope(nodes, edges, { triggerType: "schedule" })
    expect(scope && [...scope].sort()).toEqual(["img", "ref", "sched"])
  })
})
