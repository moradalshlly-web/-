import { describe, expect, it } from "vitest"
import { CHARACTER_MOTIONS, composeCharacterMotionHintFromConnections as compose, getCharacterMotion } from "../character-motion.js"
import { getCharacterMotionDiagnostics as diagnose } from "../character-motion-diagnostics.js"
import { getParameterPromptHint, getCharacterMotionBindings } from "../parameter-prompt-hint.js"
import { getPickerCatalog } from "../picker-catalogs.js"

describe("motion composition regression coverage", () => {
  it("treats replacement syntax and template words inside names literally", () => {
    const output = compose("hug-partner", ["$& the partner"], ["$` Theo"])
    expect(output).toContain("$& the partner steps toward $` Theo")
    expect(output).not.toContain("another person")
  })
  it("composes separate singular clauses for multiple named targets", () => {
    expect(compose("wave-hello", ["Mira", "Theo"], [])).toBe(`${compose("wave-hello", ["Mira"], [])}; separately, ${compose("wave-hello", ["Theo"], [])}`)
  })
  it("keeps multiple-target semantics identical in compact mode", () => {
    expect(compose("wave-hello", ["Mira", "Theo"], [], undefined, "compact")).toBe("Mira: waves hello; separately, Theo: waves hello")
  })
  it("binds an animal recipient in both modes through the shared graph path", () => {
    const node = { id: "motion", type: "character-motion", data: { characterMotion: "signal-dog-to-sit" } }
    const graph = { nodes: [node, { id: "dog", type: "creature", data: { creatureName: "Rex" } }], edges: [{ source: "dog", target: "motion", targetHandle: "partner" }] }
    for (const hintMode of ["full", "compact"]) {
      const text = getParameterPromptHint({ ...node, data: { ...node.data, hintMode } }, graph)
      expect(text).toContain("Rex")
      expect(text).not.toContain("the counterpart")
    }
    expect(getCharacterMotionBindings(node, graph).partnerNames).toEqual(["Rex"])
  })
  it("resolves saved deprecated ids and advertises a valid replacement", () => {
    expect(compose("mount-the-horse", [], [])).not.toBe("")
    for (const entry of CHARACTER_MOTIONS.filter(e => e.replacementId)) {
      expect(getCharacterMotion(entry.replacementId)?.deprecated).not.toBe(true)
      expect(getCharacterMotion(entry.replacementId)?.promptHint).toBeTruthy()
    }
  })
  it("binds counterpart tokens in both modes with an explicit fallback", () => {
    for (const entry of CHARACTER_MOTIONS.filter(e => e.counterpart)) {
      expect(entry.promptHint, entry.id).toContain("the counterpart")
      expect(entry.term, entry.id).toContain("the counterpart")
      for (const mode of ["full", "compact"] as const) {
        expect(compose(entry.id, [], [], undefined, mode), entry.id).not.toContain("the counterpart")
        expect(compose(entry.id, [], ["Named recipient"], undefined, mode), entry.id).toContain("Named recipient")
      }
    }
  })
})
describe("authored sequence diagnostics", () => {
  it("flags exits, missing transitions, occupied hands and contradictory pace", () => {
    expect(diagnose(["walk-out-left", "wave-hello"]).map(x => x.code)).toContain("visibility")
    expect(diagnose(["crawl-head-raised", "wave-hello"]).map(x => x.code)).toContain("pose")
    expect(diagnose(["hug-partner-from-behind", "wave-hello"]).map(x => x.code)).toContain("hands")
    expect(diagnose("give-slow-blink", { pace: "explosive" }).map(x => x.code)).toContain("pace")
    expect(diagnose("sun-salutation").map(x => x.code)).toContain("compound")
  })
  it("reports unknown and completely filtered selections without certifying unknown metadata", () => {
    expect(diagnose("missing")[0]?.severity).toBe("error")
    expect(diagnose("kiss-partner", undefined, { subjectMinor: true })[0]?.severity).toBe("error")
    expect(diagnose(["hold-current-pose", "wave-hello"]).some(x => x.code === "pose")).toBe(false)
  })
  it("identifies the same graph reference in both roles without confusing equal display names", () => {
    const node = { id: "motion", type: "character-motion", data: { characterMotion: "hug-partner" } }
    const nodes = [node, { id: "a", type: "character", data: { characterName: "Mira" } }, { id: "b", type: "character", data: { characterName: "Mira" } }]
    const edges = [{ source: "a", target: "motion", targetHandle: "target" }, { source: "a", target: "motion", targetHandle: "partner" }]
    const bindings = getCharacterMotionBindings(node, { nodes, edges })
    expect(diagnose("hug-partner", undefined, bindings).some(e => e.code === "roles" && e.severity === "error")).toBe(true)
    expect(getCharacterMotionBindings(node, { nodes, edges: [edges[0]!, { ...edges[1]!, source: "b" }] }).selfPairing).toBe(false)
  })
  it("passes authored metadata through catalog discovery", () => {
    const option = getPickerCatalog("character-motion")?.options?.find(e => e.id === "sun-salutation")
    expect(option?.motion?.kind).toBe("compound")
    expect(option?.motion?.requires).toContain("floor space")
  })
  it("keeps neutral dance and affection available while retaining sensual flags", () => {
    for (const id of ["sashay-forward", "roll-the-body", "hug-partner-from-behind", "drop-coat-off-shoulders"]) expect(getCharacterMotion(id)?.adultOnly).toBeUndefined()
    for (const id of ["sultry-look-over-shoulder", "kiss-partner", "bite-lip-teasingly"]) expect(getCharacterMotion(id)?.adultOnly).toBe(true)
  })
})
