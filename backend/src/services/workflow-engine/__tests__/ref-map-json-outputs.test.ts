import { describe, it, expect } from "vitest"
import { buildNodeRefMap } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * `{Label}` references to a structured producer. A Web Scrape (and the
 * video-analysis / video-audit pair) carries its result on `output.json`
 * only. The server-side ref map read text / image / video / audio and fell
 * through, so `{Research || fallback}` in a Prompt node always rendered the
 * fallback on workflow runs while the editor's own builder resolved it.
 */
function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: "json", targetHandle: "prompt" }
}

describe("buildNodeRefMap — json outputs", () => {
  const scraped = [{ title: "Original Cabin", description: "Anodised aluminium, lifetime guarantee" }]
  const scrape = node("Research", "web-scrape", { actor: "google-search", query: "cabin suitcase" })
  const llm = node("Concept", "llm-chat", { userInput: "Research: {Research || none}" })
  const edges = [edge("Research", "Concept")]

  it("resolves a web-scrape label from the live execution state, stringified", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      Research: { status: "completed", output: { json: scraped } },
    }
    const map = buildNodeRefMap("Concept", { nodes: [scrape, llm], edges, nodeStates })
    expect(map.get("research")).toBe(JSON.stringify(scraped))
  })

  it("resolves it from the saved result on node data when the scrape did not re-run", () => {
    const saved = node("Research", "web-scrape", { actor: "google-search", query: "cabin suitcase", generatedJson: scraped })
    const map = buildNodeRefMap("Concept", { nodes: [saved, llm], edges, nodeStates: {} })
    expect(map.get("research")).toBe(JSON.stringify(scraped))
  })

  it("still prefers text over json when a producer carries both", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      Research: { status: "completed", output: { text: "plain", json: scraped } },
    }
    const map = buildNodeRefMap("Concept", { nodes: [scrape, llm], edges, nodeStates })
    expect(map.get("research")).toBe("plain")
  })
})
