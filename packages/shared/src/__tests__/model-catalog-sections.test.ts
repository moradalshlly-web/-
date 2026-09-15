import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_KINDS, groupByKindAndFamily, listModels } from "../model-catalog.js"

/**
 * The Image / Video / Audio envelope of every model-discovery surface.
 *
 * #1332: `GET /v1/models` and MCP `list_models` grouped by family FIRST and
 * let the family's first model pick the section, so a vendor that ships more
 * than one kind — Google (Imagen + VEO), ByteDance (Seedream + Seedance),
 * Alibaba, xAI — was filed whole under whichever kind came first in catalog
 * order: 23 video models shipped under "image" whenever the call carried no
 * `kind` filter. The invariant that was missing: every model appears in the
 * section of its OWN kind.
 */
describe("groupByKindAndFamily", () => {
  const all = listModels({})
  const sections = groupByKindAndFamily(all)

  it("files every catalog model under the section of its own kind", () => {
    for (const section of sections) {
      for (const { models } of section.families) {
        for (const m of models) expect(m.kind, `${m.id} filed under "${section.kind}"`).toBe(section.kind)
      }
    }
  })

  it("loses nothing and duplicates nothing", () => {
    const filed = sections.flatMap((s) => s.families.flatMap((f) => f.models.map((m) => m.id))).sort()
    expect(filed).toEqual(all.map((m) => m.id).sort())
  })

  it("a vendor that ships more than one kind appears once per kind — VEO is video, Imagen is image", () => {
    const familiesOf = (kind: string) => sections.find((s) => s.kind === kind)?.families.map((f) => f.family) ?? []
    expect(familiesOf("video")).toContain("Google")
    expect(familiesOf("image")).toContain("Google")
    const videoIds = sections.find((s) => s.kind === "video")!.families.flatMap((f) => f.models.map((m) => m.id))
    for (const id of ["veo3", "veo3.1", "seedance-2", "seedance-2-5", "wan-3", "grok-i2v"]) {
      if (MODEL_CATALOG[id]) expect(videoIds, id).toContain(id)
    }
    const imageIds = sections.find((s) => s.kind === "image")!.families.flatMap((f) => f.models.map((m) => m.id))
    for (const id of videoIds) expect(imageIds).not.toContain(id)
  })

  it("keeps the fixed image → video → audio order and omits an empty section", () => {
    expect(sections.map((s) => s.kind)).toEqual([...MODEL_KINDS])
    expect(groupByKindAndFamily(all.filter((m) => m.kind === "audio")).map((s) => s.kind)).toEqual(["audio"])
    expect(groupByKindAndFamily([])).toEqual([])
  })

  it("one spelling per vendor — a family name never differs from another only by case", () => {
    const byLower = new Map<string, Set<string>>()
    for (const m of all) {
      const set = byLower.get(m.family.toLowerCase()) ?? new Set<string>()
      set.add(m.family)
      byLower.set(m.family.toLowerCase(), set)
    }
    for (const [, spellings] of byLower) expect([...spellings], [...spellings].join(" / ")).toHaveLength(1)
  })
})
