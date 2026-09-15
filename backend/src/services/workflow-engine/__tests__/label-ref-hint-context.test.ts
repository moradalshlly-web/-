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
import { getParameterPromptHint, composeCameraMotionHintFromConnections } from "@nodaro/prompts"
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

  it("hands camera-motion the graph it was given", () => {
    const cam = node("cam", "camera-motion", { cameraMotion: "dolly-in" })
    const tone = node("tone", "tone", { tone: "warm golden morning light" })
    const camNodes = [cam, tone]
    const camEdges = [edge("tone", "cam", "startState")]

    const ctx = labelRefHintContext(cam, camNodes, camEdges)
    expect(ctx?.nodes).toBe(camNodes)
    expect(ctx?.edges).toBe(camEdges)
    // Not vacuous: the graph really does change camera-motion's text.
    expect(getParameterPromptHint(cam, ctx)).not.toBe(getParameterPromptHint(cam))
  })

  it.each(["transition", "character-fx", "mood", "character", ""])(
    "gives %s no graph (its server {Label} text stays context-free)",
    (type) => {
      expect(labelRefHintContext(node("x", type), nodes, edges)).toBeUndefined()
    },
  )

  it("tolerates a node with no type", () => {
    expect(labelRefHintContext({ id: "x" }, nodes, edges)).toBeUndefined()
    expect(labelRefHintContext(undefined, nodes, edges)).toBeUndefined()
  })

  it("is exactly {camera-motion, character-motion}: widening it changes existing workflows' prompts and needs sign-off", () => {
    expect([...LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES].sort()).toEqual(["camera-motion", "character-motion"])
  })

  it("is a subset of the execution-path graph-composed set and of the parameter types", () => {
    for (const t of LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES) {
      expect(EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES.has(t), t).toBe(true)
      expect(PARAMETER_NODE_TYPES.has(t), t).toBe(true)
    }
  })
})

describe("camera-motion server {Label} text composes from the graph", () => {
  it("resolves to the composed start/end-state hint, matching the editor", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {Cam}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const startTone = node("start", "tone", { label: "Start", tone: "warm golden morning light" })
    const endTone = node("end", "tone", { label: "End", tone: "cold blue dusk" })
    const cam = node("cam", "camera-motion", { label: "Cam", cameraMotion: "dolly-in" })
    const nodes = [s2v, startTone, endTone, cam]
    const edges = [
      edge("start", "cam", "startState"),
      edge("end", "cam", "endState"),
      edge("cam", "s2v", "cinematography"),
    ]

    const contextFree = getParameterPromptHint(cam)
    const composed = getParameterPromptHint(cam, { nodes, edges })
    // Not vacuous: the graph really does change camera-motion's text.
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    // Derived from the real catalog composer, never a hand-written sentence:
    // this also cross-checks the walker in resolveParameterHint against it.
    const expected = composeCameraMotionHintFromConnections(
      "dolly-in",
      [getParameterPromptHint(startTone)],
      [getParameterPromptHint(endTone)],
    )
    expect(composed).toBe(expected)

    const prompt = buildPayload(s2v, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    // `contextFree` is a PREFIX of `composed`, so asserting it discriminates
    // nothing — the composed clause is the assertion that flipped.
    expect(prompt).toContain(expected)
    // And say what was ADDED, still derived (the composer's own tail past the
    // bare motion hint), never a hand-written "beginning with …" sentence.
    const addedClause = expected.slice(contextFree.length)
    expect(addedClause.trim()).not.toBe("")
    expect(prompt).toContain(addedClause)
  })
})

describe("transition + character-fx server {Label} text is still context-free (pin)", () => {
  it("transition: a wired startState does NOT reach its {Label} text", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {Cut}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const tone = node("tone", "tone", { label: "Tone", tone: "warm golden morning light" })
    const cut = node("cut", "transition", { label: "Cut", transition: "cross-dissolve" })
    const nodes = [s2v, tone, cut]
    const edges = [edge("tone", "cut", "startState"), edge("cut", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(cut)
    const composed = getParameterPromptHint(cut, { nodes, edges })
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    const prompt = buildPayload(s2v, "job-2", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(contextFree)
    expect(prompt).not.toContain(composed)
  })

  it("character-fx: a wired target ref does NOT reach its {Label} text", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {FX}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const mira = node("mira", "character", { label: "Mira", characterName: "Mira" })
    const fx = node("fx", "character-fx", { label: "FX", characterFx: "werewolf" })
    const nodes = [s2v, mira, fx]
    const edges = [edge("mira", "fx", "target"), edge("fx", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(fx)
    const composed = getParameterPromptHint(fx, { nodes, edges })
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    const prompt = buildPayload(s2v, "job-3", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
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
