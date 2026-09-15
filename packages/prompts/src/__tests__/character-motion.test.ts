import { describe, expect, it } from "vitest"
import {
  CHARACTER_MOTIONS,
  CHARACTER_MOTION_IDS,
  CHARACTER_MOTION_CATEGORY_ORDER,
  CHARACTER_MOTION_CATEGORY_LABELS,
  CHARACTER_MOTION_MAX_PICKS,
  composeCharacterMotionHintFromConnections as compose,
  getCharacterMotion,
  getCharacterMotionLabel,
  getCharacterMotionPromptHint as hintOf,
  getCharacterMotionTerm as termOf,
} from "../character-motion.js"

// Real ids from the catalog. Solo moves carry "the subject" only; DUO carries
// "the partner" too.
const SOLO_A = "walk-in-from-left"
const SOLO_B = "turn-to-camera"
const SOLO_C = "break-into-smile"
const SOLO_D = "wave-hello"
const DUO = "hug-partner"
const injecting = CHARACTER_MOTIONS.filter((m) => m.promptHint !== "")

describe("character-motion catalog — shape", () => {
  it("leads with the no-op auto and none heads, which inject nothing", () => {
    expect(CHARACTER_MOTIONS.slice(0, 2).map((m) => m.id)).toEqual(["auto", "none"])
    for (const id of ["auto", "none"]) {
      expect(hintOf(id)).toBe("")
      expect(termOf(id)).toBe("")
      expect(getCharacterMotion(id)?.adultOnly).toBeUndefined()
    }
  })

  it("ships 1003 injecting entries across 20 categories", () => {
    expect(injecting).toHaveLength(1003)
    expect(CHARACTER_MOTION_CATEGORY_ORDER).toHaveLength(20)
  })

  it("ids are unique kebab-case", () => {
    expect(new Set(CHARACTER_MOTION_IDS).size).toBe(CHARACTER_MOTION_IDS.length)
    for (const id of CHARACTER_MOTION_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it("labels are unique case-insensitively, so no two tiles read the same", () => {
    const labels = CHARACTER_MOTIONS.map((m) => m.label.toLowerCase())
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("every category is ordered, labelled and non-empty; every entry sits in one", () => {
    expect(new Set(CHARACTER_MOTION_CATEGORY_ORDER)).toEqual(new Set(Object.keys(CHARACTER_MOTION_CATEGORY_LABELS)))
    for (const cat of CHARACTER_MOTION_CATEGORY_ORDER) {
      expect(injecting.some((m) => m.category === cat), `${cat} is empty`).toBe(true)
    }
    for (const m of CHARACTER_MOTIONS) expect(CHARACTER_MOTION_CATEGORY_ORDER).toContain(m.category)
  })

  it("the substitution tokens match the flags exactly", () => {
    for (const m of injecting) {
      expect(m.promptHint, `${m.id} hint must name the subject`).toMatch(/\bthe subject\b/)
      expect(/\bthe partner\b/.test(m.promptHint), `${m.id}: hint partner token vs twoPerson`).toBe(m.twoPerson === true)
      expect(m.term, `${m.id} needs an authored term`).toBeTruthy()
      expect(m.term!, `${m.id}: a term never names the subject (compact mode prefixes it)`).not.toMatch(/\bthe subject\b/)
      expect(/\bthe partner\b/.test(m.term!), `${m.id}: term partner token vs twoPerson`).toBe(m.twoPerson === true)
      expect(m.promptHint.endsWith("."), `${m.id} trailing period`).toBe(false)
    }
  })
})

describe("character-motion getters", () => {
  it("resolve known ids and return nothing for nullish or unknown ids", () => {
    expect(getCharacterMotion(SOLO_D)?.id).toBe(SOLO_D)
    expect(getCharacterMotion(undefined)).toBeUndefined()
    expect(getCharacterMotion(null)).toBeUndefined()
    expect(getCharacterMotion("no-such-move")).toBeUndefined()
    expect(hintOf("no-such-move")).toBe("")
    expect(termOf("no-such-move")).toBe("")
  })

  it("label falls back to the title-cased id, or empty for nullish", () => {
    expect(getCharacterMotionLabel("no-such-move")).toBe("No Such Move")
    expect(getCharacterMotionLabel(null)).toBe("")
  })
})

describe("composeCharacterMotionHintFromConnections — full mode", () => {
  it("a single unwired pick is the bare hint", () => {
    expect(compose(SOLO_A, [], [])).toBe(hintOf(SOLO_A))
  })

  it("auto, none, unknown, null and [] inject nothing", () => {
    for (const v of ["auto", "none", "no-such-move", null, undefined, [] as string[]]) {
      expect(compose(v, ["Aria"], ["Ben"])).toBe("")
    }
  })

  it("substitutes the wired target for every 'the subject'", () => {
    expect(compose(SOLO_A, ["Aria"], [])).toBe(hintOf(SOLO_A).replace(/\bthe subject\b/g, "Aria"))
  })

  it("joins the picks as an ordered sequence with ', then '", () => {
    expect(compose([SOLO_B, SOLO_A], [], [])).toBe(`${hintOf(SOLO_B)}, then ${hintOf(SOLO_A)}`)
  })

  it(`de-duplicates, keeps first-pick order, then caps at ${CHARACTER_MOTION_MAX_PICKS}`, () => {
    expect(compose([SOLO_A, SOLO_A, SOLO_B, SOLO_C, SOLO_D], [], [])).toBe(
      [SOLO_A, SOLO_B, SOLO_C].map((id) => hintOf(id)).join(", then "),
    )
  })

  it("an unwired partner reads 'another person' — the literal token never ships", () => {
    const out = compose(DUO, [], [])
    expect(out).not.toMatch(/\bthe partner\b/)
    expect(out).toBe(hintOf(DUO).replace(/\bthe partner\b/g, "another person"))
  })

  it("substitutes both wired names", () => {
    expect(compose(DUO, ["Aria"], ["Ben"])).toBe(
      hintOf(DUO).replace(/\bthe subject\b/g, "Aria").replace(/\bthe partner\b/g, "Ben"),
    )
  })

  it("appends the position clause, then the pace clause", () => {
    expect(compose(SOLO_A, [], [], { position: "start", pace: "slow-motion" })).toBe(
      `${hintOf(SOLO_A)}, the movement begins at the opening of the clip, the action is rendered in slow motion, every phase of the movement stretched and drawn out`,
    )
  })

  it("auto timing adds nothing", () => {
    expect(compose(SOLO_A, [], [], { position: "auto", pace: "auto" })).toBe(hintOf(SOLO_A))
  })
})

describe("composeCharacterMotionHintFromConnections — compact mode", () => {
  it("joins terms with ', then ' and has no prefix when unwired", () => {
    expect(compose([SOLO_B, SOLO_C], [], [], undefined, "compact")).toBe(`${termOf(SOLO_B)}, then ${termOf(SOLO_C)}`)
  })

  it("prefixes the wired target", () => {
    expect(compose(SOLO_A, ["Aria"], [], undefined, "compact")).toBe(`Aria: ${termOf(SOLO_A)}`)
  })

  it("substitutes the partner inside a two-person term", () => {
    expect(compose([SOLO_A, DUO], ["Aria"], ["Ben"], undefined, "compact")).toBe(
      `Aria: ${termOf(SOLO_A)}, then ${termOf(DUO).replace(/\bthe partner\b/g, "Ben")}`,
    )
    expect(compose(DUO, [], [], undefined, "compact")).toBe(termOf(DUO).replace(/\bthe partner\b/g, "another person"))
  })

  it("timing clauses are the same promptHint strings in compact mode", () => {
    expect(compose(SOLO_A, [], [], { pace: "fast" }, "compact")).toBe(
      `${termOf(SOLO_A)}, performed quickly, with brisk urgent tempo and sharp transitions between phases`,
    )
  })
})

// The composer is the floor for adult-only moves on the video prompt: its
// caller reports a minor subject and every `adultOnly` pick is dropped.
describe("composeCharacterMotionHintFromConnections — minor-age floor", () => {
  const ADULT = "kiss-partner"
  const ADULT_B = "lean-in-almost-kiss"
  const MODES = ["full", "compact"] as const
  const MINOR = { subjectMinor: true } as const

  it("the fixtures carry the flags these tests rely on", () => {
    expect(getCharacterMotion(ADULT)?.adultOnly).toBe(true)
    expect(getCharacterMotion(ADULT_B)?.adultOnly).toBe(true)
    for (const id of [SOLO_A, SOLO_B, SOLO_D]) expect(getCharacterMotion(id)?.adultOnly).toBeUndefined()
  })

  it("drops an adult-only pick for a minor subject and keeps the neutral one, in both modes", () => {
    const full = compose([SOLO_D, ADULT], [], [], undefined, "full", MINOR)
    expect(full).toBe(hintOf(SOLO_D))
    expect(full).not.toMatch(/kiss/i)
    const compact = compose([SOLO_D, ADULT], [], [], undefined, "compact", MINOR)
    expect(compact).toBe(termOf(SOLO_D))
    expect(compact).not.toMatch(/kiss/i)
  })

  it("only adult-only picks for a minor inject nothing — no timing clauses either", () => {
    for (const mode of MODES) {
      expect(compose([ADULT, ADULT_B], ["Aria"], ["Ben"], { position: "start", pace: "fast" }, mode, MINOR)).toBe("")
      expect(compose(ADULT, [], [], undefined, mode, MINOR)).toBe("")
    }
  })

  it("subjectMinor false and an omitted floor are byte-identical and keep the adult-only pick", () => {
    for (const mode of MODES) {
      const picks = [SOLO_D, ADULT]
      const omitted = compose(picks, ["Aria"], ["Ben"], undefined, mode)
      expect(compose(picks, ["Aria"], ["Ben"], undefined, mode, { subjectMinor: false })).toBe(omitted)
      expect(compose(picks, ["Aria"], ["Ben"], undefined, mode, {})).toBe(omitted)
      const kiss = mode === "full"
        ? hintOf(ADULT).replace(/\bthe subject\b/g, "Aria").replace(/\bthe partner\b/g, "Ben")
        : termOf(ADULT).replace(/\bthe partner\b/g, "Ben")
      expect(omitted).toContain(kiss)
    }
  })

  it(`caps the user's picks at ${CHARACTER_MOTION_MAX_PICKS} before dropping, so a later pick never backfills`, () => {
    expect(compose([SOLO_A, ADULT, SOLO_B, SOLO_D], [], [], undefined, "full", MINOR)).toBe(
      `${hintOf(SOLO_A)}, then ${hintOf(SOLO_B)}`,
    )
    expect(compose([SOLO_A, ADULT, SOLO_B, SOLO_D], [], [], undefined, "compact", MINOR)).toBe(
      `${termOf(SOLO_A)}, then ${termOf(SOLO_B)}`,
    )
  })
})
