/**
 * `{Label}` ref path graph context — which parameter pickers compose from the
 * graph when a prompt places them by label on the SERVER.
 *
 * Three sites turn a parameter node into `{Label}` text: the orchestrator's
 * pre-completion, the sub-workflow handler's pre-completion, and the
 * `buildNodeRefMap` fallback. They must agree, so all three ask the one helper.
 * The worker entry is not unit-drivable (BullMQ + Supabase), so the placement
 * is pinned by reading the source, like catalog-guard-wiring.test.ts. The
 * sub-workflow site also has a behavioral test in sub-workflow-handler.test.ts,
 * and the ref-map site in payload-builder-character-motion.test.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES, PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { getParameterPromptHint } from "@nodaro/prompts"
import { LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES, labelRefHintContext } from "../label-ref-hint-context.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: null, targetHandle }
}

describe("labelRefHintContext", () => {
  const nodes = [
    node("mira", "character", { characterName: "Mira" }),
    node("m", "character-motion", { characterMotion: ["wave-hello"] }),
  ]
  const edges = [edge("mira", "m", "target")]

  it("hands character-motion the graph it was given", () => {
    const ctx = labelRefHintContext(nodes[1], nodes, edges)
    expect(ctx?.nodes).toBe(nodes)
    expect(ctx?.edges).toBe(edges)
    expect(getParameterPromptHint(nodes[1], ctx)).toMatch(/^Mira /)
  })

  it.each(["camera-motion", "transition", "character-fx", "mood", "character", ""])(
    "gives %s no graph (its server {Label} text stays context-free)",
    (type) => {
      expect(labelRefHintContext(node("x", type), nodes, edges)).toBeUndefined()
    },
  )

  it("tolerates a node with no type", () => {
    expect(labelRefHintContext({ id: "x" }, nodes, edges)).toBeUndefined()
    expect(labelRefHintContext(undefined, nodes, edges)).toBeUndefined()
  })

  it("is exactly {character-motion}: widening it changes existing workflows' prompts and needs sign-off", () => {
    expect([...LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES].sort()).toEqual(["character-motion"])
  })

  it("is a subset of the execution-path graph-composed set and of the parameter types", () => {
    for (const t of LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES) {
      expect(EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES.has(t), t).toBe(true)
      expect(PARAMETER_NODE_TYPES.has(t), t).toBe(true)
    }
  })
})

describe("camera-motion server {Label} text is unchanged (pin)", () => {
  it("resolves to the context-free hint even though a start state is wired", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {Cam}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const tone = node("tone", "tone", { label: "Tone", tone: "warm golden morning light" })
    const cam = node("cam", "camera-motion", { label: "Cam", cameraMotion: "dolly-in" })
    const nodes = [s2v, tone, cam]
    const edges = [edge("tone", "cam", "startState"), edge("cam", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(cam)
    const composed = getParameterPromptHint(cam, { nodes, edges })
    // Not vacuous: the graph WOULD change camera-motion's text if it were passed.
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    const prompt = buildPayload(s2v, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(contextFree)
    expect(prompt).not.toContain(composed)
  })
})

describe("every server {Label} pre-completion site asks the shared helper", () => {
  const CALL = (nodeVar: string, nodesVar: string, edgesVar: string) =>
    new RegExp(
      `getParameterPromptHint\\(\\s*${nodeVar}\\s*,\\s*labelRefHintContext\\(\\s*${nodeVar}\\s*,\\s*${nodesVar}\\s*,\\s*${edgesVar}\\s*\\)\\s*\\)`,
    )
  const BARE = (nodeVar: string) => new RegExp(`getParameterPromptHint\\(\\s*${nodeVar}\\s*\\)`)

  it("orchestrator worker: parameter pre-completion passes the run graph", () => {
    const src = read("workers/orchestrator-worker.ts")
    expect(src).toMatch(CALL("node", "nodes", "edges"))
    expect(src).not.toMatch(BARE("node"))
  })

  it("sub-workflow handler: parameter pre-completion passes the SUB-graph", () => {
    const src = read("services/workflow-engine/sub-workflow-handler.ts")
    expect(src).toMatch(CALL("subNode", "subNodes", "subEdges"))
    expect(src).not.toMatch(BARE("subNode"))
  })

  it("buildNodeRefMap: the parameter fallback passes the graph", () => {
    const src = read("services/workflow-engine/payload-builder.ts")
    const start = src.indexOf("export function buildNodeRefMap(")
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf("\n}\n", start))
    expect(body).toMatch(CALL("node", "nodes", "edges"))
    expect(body).not.toContain("getNodePromptHint(")
  })
})
