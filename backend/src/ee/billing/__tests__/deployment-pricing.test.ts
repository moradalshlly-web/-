import { describe, expect, it, vi } from "vitest"
import { buildLlmCreditIdentifier } from "@nodaro/shared"
import { deploymentPriceDefinitions, resolveDeploymentPrices } from "../deployment-pricing.js"

describe("deployment pricing identifiers", () => {
  it.each(["gemini-3-flash", "gemini-3.6-flash", "claude-haiku-4.5", "claude-sonnet-5", "gpt-5.5"])("prices %s through charged operations, not its bare catalog ID", async id => {
    const price = vi.fn(async (key: string) => { if (key === id) throw new Error("unpriced bare model"); return 17 })
    const resolved = await resolveDeploymentPrices([id], price)
    const definition = resolved.definitions.get(id)!
    expect(definition.baseIdentifier).toBe(buildLlmCreditIdentifier("llm-chat", id))
    expect(definition.variants).toContainEqual(expect.objectContaining({ operation: "ai-writer", identifier: buildLlmCreditIdentifier("ai-writer", id) }))
    expect(price).not.toHaveBeenCalledWith(id)
    expect(resolved.prices.get(definition.baseIdentifier)).toEqual({ status: "fulfilled", value: 17 })
  })
  it("resolves media variants through effective prices and deduplicates reads", async () => {
    const definitions = deploymentPriceDefinitions("nano-banana-pro")
    expect(definitions.variants.length).toBeGreaterThan(1)
    const price = vi.fn(async () => 123)
    const resolved = await resolveDeploymentPrices(["nano-banana-pro", "nano-banana-pro"], price)
    expect(price).toHaveBeenCalledTimes(resolved.identifiers.length)
    for (const row of resolved.prices.values()) expect(row).toEqual({ status: "fulfilled", value: 123 })
  })
  it("isolates a missing variant instead of substituting static catalog prices", async () => {
    const resolved = await resolveDeploymentPrices(["nano-banana-pro"], async () => { throw new Error("missing") })
    for (const row of resolved.prices.values()) expect(row.status).toBe("rejected")
  })
})
