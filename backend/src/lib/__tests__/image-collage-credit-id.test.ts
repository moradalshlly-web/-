import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { imageCollageCreditModelIdentifier } from "../image-collage-credit-id.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * A single-node collage reserved 2 / 4 credits while a workflow run reserved
 * 20 / 40 for the same render: the route priced through a hand-typed
 * `computeCredits` hook that the ×10 re-denomination never reached. Both paths
 * now build ONE composite id and let the price table answer.
 */
describe("image-collage credit identifier", () => {
  it("maps each resolution to its priced composite row; absent/unknown prices as the route's 4K default", () => {
    expect(imageCollageCreditModelIdentifier("2K")).toBe("image-collage:2K")
    expect(imageCollageCreditModelIdentifier("4K")).toBe("image-collage:4K")
    expect(imageCollageCreditModelIdentifier(undefined)).toBe("image-collage:4K")
    expect(imageCollageCreditModelIdentifier("8K")).toBe("image-collage:4K")
  })

  it("both rows are priced in the table, at the re-denominated figures the bare node row implies", () => {
    expect(STATIC_CREDIT_COSTS["image-collage:2K"]).toBe(STATIC_CREDIT_COSTS["image-collage"])
    expect(STATIC_CREDIT_COSTS["image-collage:4K"]).toBeGreaterThan(STATIC_CREDIT_COSTS["image-collage:2K"]!)
    expect(STATIC_CREDIT_COSTS["image-collage:2K"]).toBeGreaterThanOrEqual(10)
  })

  it("the route and the workflow run both price through the helper — no hand-typed credit number remains on the route", () => {
    const route = readFileSync(resolve(here, "../../routes/image-collage.ts"), "utf8")
    const builder = readFileSync(resolve(here, "../../services/workflow-engine/payload-builder.ts"), "utf8")
    expect(route).toContain("imageCollageCreditModelIdentifier(")
    expect(route).not.toMatch(/computeCredits:/)
    expect(route).not.toMatch(/resolution === "4K" \? \d+ : \d+/)
    expect(builder).toContain("imageCollageCreditModelIdentifier(resolution)")
    expect(builder).not.toContain("`image-collage:${resolution}`")
  })
})
