/**
 * Character Motion's two timing parameters (position / pace) are enumerable
 * catalogs so id-only consumers (Studio, the SDK, MCP) can offer them. Twin of
 * `character-fx-timing-catalogs.test.ts`; the wording is this node's own and
 * nothing here may couple it to the transition or character-fx rows.
 */
import { describe, it, expect } from "vitest"
import {
  CHARACTER_MOTION_POSITIONS,
  CHARACTER_MOTION_PACES,
  composeCharacterMotionHintFromConnections,
} from "../character-motion.js"
import { CHARACTER_FX_POSITIONS } from "../character-fx.js"
import { TRANSITION_POSITIONS } from "../transitions.js"

const MOVE = "walk-in-from-left"
const DIMENSIONS = [
  ["position", CHARACTER_MOTION_POSITIONS],
  ["pace", CHARACTER_MOTION_PACES],
] as const

describe("character-motion timing catalogs", () => {
  it("spells exactly the ids stored workflows will use", () => {
    expect(CHARACTER_MOTION_POSITIONS.map((o) => o.id)).toEqual(["auto", "start", "middle", "end", "full"])
    expect(CHARACTER_MOTION_PACES.map((o) => o.id)).toEqual(["auto", "slow-motion", "slow", "natural", "fast", "explosive"])
  })

  it("pins the injected clauses byte for byte", () => {
    expect(CHARACTER_MOTION_POSITIONS.map((o) => o.promptHint)).toEqual([
      "",
      "the movement begins at the opening of the clip",
      "the movement begins midway through the clip",
      "the movement happens in the closing moments of the clip",
      "the movement plays out across the entire clip",
    ])
    expect(CHARACTER_MOTION_PACES.map((o) => o.promptHint)).toEqual([
      "",
      "the action is rendered in slow motion, every phase of the movement stretched and drawn out",
      "performed slowly and deliberately, each phase of the movement given its full time",
      "performed at a natural everyday tempo, neither rushed nor drawn out",
      "performed quickly, with brisk urgent tempo and sharp transitions between phases",
      "performed with an explosive burst of energy, snapping from stillness into full-speed motion",
    ])
  })

  it("keeps its own position wording — not the character-fx or transition rows", () => {
    const mine = CHARACTER_MOTION_POSITIONS.map((o) => o.promptHint)
    expect(mine).not.toEqual(CHARACTER_FX_POSITIONS.map((o) => o.promptHint))
    expect(mine).not.toEqual(TRANSITION_POSITIONS.map((o) => o.promptHint))
  })

  it("every scale leads with a no-op auto; every other step has a hint and a term", () => {
    for (const [field, options] of DIMENSIONS) {
      expect(options[0]!.id, field).toBe("auto")
      expect(options[0]!.promptHint, field).toBe("")
      expect(options[0]!.term, field).toBe("")
      for (const o of options.slice(1)) {
        expect(o.promptHint, `${field}/${o.id}`).not.toBe("")
        expect(o.term, `${field}/${o.id}`).toBeTruthy()
      }
    }
  })

  it("composes every step verbatim with no dangling separator, in both modes", () => {
    for (const [field, options] of DIMENSIONS) {
      for (const o of options.slice(1)) {
        for (const mode of ["full", "compact"] as const) {
          const out = composeCharacterMotionHintFromConnections(MOVE, [], [], { [field]: o.id } as never, mode)
          expect(out, `${field}/${o.id} ${mode}`).toContain(o.promptHint)
          expect(out, `${field}/${o.id} ${mode}`).not.toMatch(/,\s*$/)
          expect(out, `${field}/${o.id} ${mode}`).not.toContain("undefined")
        }
      }
    }
  })
})
