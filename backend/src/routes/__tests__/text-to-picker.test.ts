import { describe, it, expect } from "vitest"
import { batchTargetPickers, mergeGaps } from "../text-to-picker.js"
import { PICKER_TYPES, PICKER_ANALYZER_FAMILIES, type PickerType } from "@nodaro/prompts"

describe("batchTargetPickers", () => {
  it("small subsets stay a single batch (no fan-out below the threshold)", () => {
    const targets = ["person", "styling", "framing"] as PickerType[]
    expect(batchTargetPickers(targets)).toEqual([targets])
  })

  it("the full default (all 39) fans out per family, covering every requested picker exactly once", () => {
    const batches = batchTargetPickers([...PICKER_TYPES])
    expect(batches.length).toBe(Object.keys(PICKER_ANALYZER_FAMILIES).length)
    const flat = batches.flat()
    expect(flat.sort()).toEqual([...PICKER_TYPES].sort())
    expect(new Set(flat).size).toBe(flat.length)
  })

  it("a large cross-family subset batches by family and keeps only requested pickers", () => {
    const targets = [
      "setting", "atmosphere", "style", "mood", "framing",
      "lighting", "person", "animal", "music-genre", "voice-delivery",
    ] as PickerType[]
    const batches = batchTargetPickers(targets)
    expect(batches.flat().sort()).toEqual([...targets].sort())
    for (const batch of batches) {
      const families = Object.values(PICKER_ANALYZER_FAMILIES)
      expect(families.some((fam) => batch.every((t) => fam.includes(t)))).toBe(true)
    }
  })

  it("every family member is registered in the analyzer registry (partition totality)", () => {
    const inFamilies = Object.values(PICKER_ANALYZER_FAMILIES).flat()
    expect([...inFamilies].sort()).toEqual([...PICKER_TYPES].sort())
  })
})

describe("mergeGaps", () => {
  it("returns undefined when no batch produced gaps", () => {
    expect(mergeGaps([undefined, undefined])).toBeUndefined()
    expect(mergeGaps([{ missingItems: [], missingCategories: [] }])).toBeUndefined()
  })

  it("concatenates items and categories across batches", () => {
    const merged = mergeGaps([
      { missingItems: [{ picker: "setting", dimension: "setting", observed: "space station" }], missingCategories: [] },
      undefined,
      { missingItems: [], missingCategories: [{ picker: "lighting", suggestedDimension: "flicker", observed: "strobing" }] },
    ])
    expect(merged?.missingItems).toHaveLength(1)
    expect(merged?.missingCategories).toHaveLength(1)
  })
})
