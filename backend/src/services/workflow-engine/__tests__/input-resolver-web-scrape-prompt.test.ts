import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * A Web Scrape wired into a Prompt (llm-chat) node: the scrape's `json` output
 * must arrive as the prompt TEXT (stringified), so the LLM can work on the
 * scraped page. The editor's connection validator now allows this wire
 * (frontend TEXT_PRODUCER_TYPES); this pins the server-side half so the two
 * cannot drift apart.
 */
function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string, sourceHandle: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle }
}

describe("backend input-resolver — web-scrape json → Prompt node", () => {
  const scraped = [{ title: "Nodaro", url: "https://nodaro.ai", text: "Visual workflow platform" }]

  it("delivers the scraped JSON, stringified, as the prompt when the scrape ran in this execution", () => {
    const scrape = node("scrape", "web-scrape", { actor: "content-crawler", url: "https://nodaro.ai" })
    const llm = node("llm", "llm-chat", { userInput: "" })
    const states: Record<string, NodeExecutionState> = {
      scrape: { status: "completed", output: { json: scraped } },
    }
    const r = resolveNodeInputs(llm, [edge("scrape", "llm", "json", "prompt")], states, [scrape, llm])
    expect(r.prompt).toBe(JSON.stringify(scraped))
  })

  it("delivers the saved scrape result when the scrape is not re-run (orchestrator pre-completes it from node data)", () => {
    const scrape = node("scrape", "web-scrape", { actor: "content-crawler", url: "https://nodaro.ai", generatedJson: scraped })
    const llm = node("llm", "llm-chat", { userInput: "" })
    // A "run from here" / partial run seeds the skipped upstream's state from
    // its saved data (extractSavedNodeOutput) before the resolver runs.
    const saved = extractSavedNodeOutput(scrape)
    expect(saved).toEqual({ json: scraped })
    const states: Record<string, NodeExecutionState> = { scrape: { status: "completed", output: saved } }
    const r = resolveNodeInputs(llm, [edge("scrape", "llm", "json", "prompt")], states, [scrape, llm])
    expect(r.prompt).toBe(JSON.stringify(scraped))
  })
})
