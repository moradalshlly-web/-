import { describe, expect, it } from "vitest"
import {
  TRANSITIONS,
  TRANSITION_DURATIONS,
  composeTransitionHintFromConnections,
  isInstantTransition,
} from "../transitions.js"
import { getPickerCatalog } from "../picker-catalogs.js"

/**
 * F5 (transition QA, 2026-09-22): a duration clause on a cut ("match cut, …,
 * lasting approximately 1 second") made the video model render a 1.75 s
 * dissolve. Rows whose mechanism IS a cut carry `instant: true`, and the
 * composer drops the duration lever for them.
 */
const INSTANT_IDS = [
  "none",
  "snap-to-black",
  "match-cut",
  "smash-cut",
  "seamless-match",
  "jump-cut",
  "jump-match",
  "action-relay",
]

const DURATION_HINTS = TRANSITION_DURATIONS.map((d) => d.promptHint).filter((h) => h.length > 0)

describe("instant transitions — the catalog marker", () => {
  it("marks exactly the cut rows", () => {
    expect(TRANSITIONS.filter((t) => t.instant).map((t) => t.id).sort()).toEqual([...INSTANT_IDS].sort())
  })

  it("isInstantTransition answers per id, and false for unknown / auto / empty", () => {
    for (const id of INSTANT_IDS) expect(isInstantTransition(id)).toBe(true)
    expect(isInstantTransition("cross-dissolve")).toBe(false)
    expect(isInstantTransition("whip-pan")).toBe(false)
    expect(isInstantTransition("freeze-frame-jump")).toBe(false)
    expect(isInstantTransition("auto")).toBe(false)
    expect(isInstantTransition("nonexistent")).toBe(false)
    expect(isInstantTransition("")).toBe(false)
    expect(isInstantTransition(undefined)).toBe(false)
    expect(isInstantTransition(null)).toBe(false)
    expect(isInstantTransition([])).toBe(false)
  })

  it("a multi-pick is instant only when every id is", () => {
    expect(isInstantTransition(["match-cut", "smash-cut"])).toBe(true)
    expect(isInstantTransition(["match-cut", "cross-dissolve"])).toBe(false)
  })
})

describe("instant transitions — the composer drops the duration lever", () => {
  for (const mode of ["full", "compact"] as const) {
    it(`${mode}: no duration clause on any instant row, for every duration`, () => {
      for (const id of INSTANT_IDS) {
        for (const d of TRANSITION_DURATIONS) {
          const r = composeTransitionHintFromConnections(id, [], [], { duration: d.id }, mode)
          for (const hint of DURATION_HINTS) expect(r).not.toContain(hint)
        }
      }
    })

    it(`${mode}: position and intensity still apply to a cut`, () => {
      const r = composeTransitionHintFromConnections(
        "match-cut", [], [], { position: "middle", duration: "short", intensity: "natural" }, mode,
      )
      expect(r).toContain("the transition occurs in the middle of the clip")
      expect(r).toContain("with natural unhurried timing")
      expect(r).not.toContain("lasting approximately")
    })
  }

  it("compact match cut reads term + position + intensity only", () => {
    expect(
      composeTransitionHintFromConnections(
        "match-cut", [], [], { position: "middle", duration: "short", intensity: "natural" }, "compact",
      ),
    ).toBe("match cut, the transition occurs in the middle of the clip, with natural unhurried timing")
  })

  it("a non-instant row keeps its duration", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { duration: "short" })
    expect(r).toContain("lasting approximately 1 second")
  })

  it("a mixed pick keeps its duration — the non-cut still has a length", () => {
    const r = composeTransitionHintFromConnections(["match-cut", "ink-splash"], [], [], { duration: "short" })
    expect(r).toContain("lasting approximately 1 second")
  })

  it("a no-op 'auto' beside a cut does not make the pick non-instant", () => {
    const r = composeTransitionHintFromConnections(["auto", "smash-cut"], [], [], { duration: "long" })
    expect(r).not.toContain("lasting approximately")
  })
})

describe("instant transitions — on the wire catalog", () => {
  it("the transition picker options carry instant: true on exactly the cut rows", () => {
    const options = getPickerCatalog("transition")?.options ?? []
    expect(options.length).toBe(TRANSITIONS.length)
    expect(options.filter((o) => o.instant === true).map((o) => o.id).sort()).toEqual([...INSTANT_IDS].sort())
    // Absent (not `false`) everywhere else, so a non-transition catalog's shape is unchanged.
    for (const o of options) if (!INSTANT_IDS.includes(o.id)) expect(o).not.toHaveProperty("instant")
  })

  it("no other catalog grows the field", () => {
    const camera = getPickerCatalog("camera-motion")?.options ?? []
    expect(camera.length).toBeGreaterThan(0)
    for (const o of camera) expect(o).not.toHaveProperty("instant")
  })
})
