/**
 * The unwired partner / counterpart referent.
 *
 * A two-person hint can name "the partner" up to five times, and 74 of the 100
 * two-person hints name it more than once. Substituting the same INDEFINITE
 * fallback at every occurrence ("another person … another person's back … as
 * another person arches") reads as several different people. The composer now
 * introduces the referent at its first occurrence in the composed string and
 * refers back to it afterwards ("that same person"); the wired path, where the
 * name is already unambiguous, is a plain global replace exactly as before.
 */
import { describe, expect, it } from "vitest"
import {
  CHARACTER_MOTIONS,
  composeCharacterMotionHintFromConnections as compose,
  getCharacterMotionPromptHint as hintOf,
  getCharacterMotionTerm as termOf,
} from "../character-motion.js"

const RECIPIENT = /\bthe (partner|counterpart)\b/g
const mentions = (text: string) => (text.match(RECIPIENT) ?? []).length
/** Every entry whose text addresses a second participant, in either mode. */
const recipientEntries = CHARACTER_MOTIONS.filter(
  (m) => mentions(m.promptHint) > 0 || mentions(m.term ?? "") > 0,
)

describe("character motion — the wired path is a plain global replace", () => {
  it("has entries to check", () => {
    expect(recipientEntries.length).toBeGreaterThan(100)
  })

  it("substitutes a wired name at EVERY occurrence, in both modes", () => {
    for (const entry of recipientEntries) {
      const named = (text: string) =>
        text.replace(/\bthe subject\b/g, "Aria").replace(RECIPIENT, "Ben")
      expect(compose(entry.id, ["Aria"], ["Ben"]), `${entry.id} full`).toBe(named(hintOf(entry.id)))
      expect(compose(entry.id, ["Aria"], ["Ben"], undefined, "compact"), `${entry.id} compact`).toBe(
        `Aria: ${named(termOf(entry.id))}`,
      )
    }
  })

  it("substitutes a wired name at every occurrence of EVERY target clause too", () => {
    // Multiple targets are what the per-target referent scope touches; the wired
    // path must stay a plain global replace there as well, byte for byte.
    for (const entry of recipientEntries) {
      const named = (text: string, subject: string) =>
        text.replace(/\bthe subject\b/g, subject).replace(RECIPIENT, "Ben")
      expect(compose(entry.id, ["Mira", "Ada"], ["Ben"]), `${entry.id} full`).toBe(
        `${named(hintOf(entry.id), "Mira")}; separately, ${named(hintOf(entry.id), "Ada")}`,
      )
      expect(compose(entry.id, ["Mira", "Ada"], ["Ben"], undefined, "compact"), `${entry.id} compact`).toBe(
        `Mira: ${named(termOf(entry.id), "Mira")}; separately, Ada: ${named(termOf(entry.id), "Ada")}`,
      )
    }
  })

  it("never rewrites a repeated wired name — it is already unambiguous", () => {
    const repeated = recipientEntries.filter((m) => mentions(m.promptHint) > 1)
    expect(repeated.length).toBeGreaterThan(70)
    for (const entry of repeated) {
      const out = compose(entry.id, ["Aria"], ["Ben"])
      expect(out.match(/\bBen\b/g)?.length, entry.id).toBe(mentions(entry.promptHint))
      expect(out, entry.id).not.toContain("that same")
    }
  })
})

describe("character motion — an unwired recipient is one referent", () => {
  it("no authored text already contains the composed referent phrases", () => {
    // Guards the counting assertions below against a hint that happens to
    // spell "another person" or "that same …" on its own.
    for (const entry of CHARACTER_MOTIONS) {
      expect(`${entry.promptHint} ${entry.term ?? ""}`, entry.id).not.toMatch(/another person|that same/)
    }
  })

  it("introduces 'another person' exactly once per entry and refers back after", () => {
    const twoPerson = CHARACTER_MOTIONS.filter((m) => mentions(m.promptHint) > 0 && m.twoPerson)
    expect(twoPerson.length).toBeGreaterThan(90)
    for (const entry of twoPerson) {
      const out = compose(entry.id, ["Aria"], [])
      expect(out, entry.id).not.toMatch(/\bthe partner\b/)
      expect(out.match(/another person/g)?.length, entry.id).toBe(1)
      expect(out.match(/that same person/g)?.length ?? 0, entry.id).toBe(mentions(entry.promptHint) - 1)
    }
  })

  it("renders possessives on both mentions", () => {
    expect(compose("dip-the-partner", ["Mira"], [], undefined, "full")).toBe(
      "Mira steps forward and dips another person backward, one arm supporting that same person's back " +
        "as that same person arches the spine and extends one leg, holding the dip then lifting them upright",
    )
  })

  it("shares ONE referent across the picks of a sequence", () => {
    const out = compose(["dip-the-partner", "spin-partner"], ["Mira"], [])
    expect(out.match(/another person/g)).toHaveLength(1)
    expect(out.indexOf("another person")).toBeLessThan(out.indexOf("that same person"))
    // The second pick refers back to the person the first pick introduced.
    expect(out).toContain("then Mira raises that same person's hand overhead")
  })

  it("shares that referent in compact mode too — same rule, same scope", () => {
    expect(compose(["dip-the-partner", "spin-partner"], ["Mira"], [], undefined, "compact")).toBe(
      "Mira: dips another person backward, then spins that same person under the arm",
    )
  })

  /**
   * Each target performs a SEPARATE COPY of the sequence — the promise the
   * `multiple-targets` diagnostic makes to the user — so the referent is scoped
   * to one target's clauses, NOT to the whole composed string. Sharing it across
   * the "; separately, " join made the second performer act on the first
   * performer's partner: one person bridal-carried by two people at once.
   */
  it("gives each target its OWN partner — a separate copy of the sequence", () => {
    const out = compose("carry-partner-bridal", ["Mira", "Ada"], [])
    expect(out.match(/another person/g), "one introduction per target").toHaveLength(2)
    expect(out).toBe(
      "Mira scoops another person up in a bridal carry, one arm under that same person's knees " +
        "and the other behind that same person's back, that same person's arm around Mira's neck, " +
        "and walks forward carrying that same person" +
        "; separately, " +
        "Ada scoops another person up in a bridal carry, one arm under that same person's knees " +
        "and the other behind that same person's back, that same person's arm around Ada's neck, " +
        "and walks forward carrying that same person",
    )
  })

  it("keeps BOTH scopes at once: per target, shared across that target's picks", () => {
    const out = compose(["dip-the-partner", "spin-partner"], ["Mira", "Ada"], [])
    // Two targets ⇒ two introductions; each target's second pick refers back to
    // its own, across the other target's clause interleaved between them.
    expect(out.match(/another person/g)).toHaveLength(2)
    expect(out).toContain("Mira steps forward and dips another person backward")
    expect(out).toContain("; separately, Ada steps forward and dips another person backward")
    expect(out).toContain("then Mira raises that same person's hand overhead")
    expect(out).toContain("; separately, Ada raises that same person's hand overhead")
  })

  it("scopes per target in compact mode on the same rule", () => {
    expect(compose(["dip-the-partner", "spin-partner"], ["Mira", "Ada"], [], undefined, "compact")).toBe(
      "Mira: dips another person backward; separately, Ada: dips another person backward, " +
        "then Mira: spins that same person under the arm; separately, Ada: spins that same person under the arm",
    )
  })
})

describe("character motion — counterpart nouns are tracked per referent", () => {
  it("introduces an indefinite animal noun once, then refers back", () => {
    expect(compose("stroke-horse-neck", ["Mira"], [])).toBe(
      "Mira lays a flat palm high on a horse's neck and sweeps it down the length of the crest " +
        "in long full strokes, the other hand resting at that same horse's shoulder",
    )
  })

  it("carries one referent across picks that declare the SAME noun", () => {
    expect(compose(["pet-a-dog", "offer-a-treat"], ["Mira"], [])).toContain(
      "extends an open palm holding a treat toward that same dog",
    )
  })

  it("gives picks with DIFFERENT nouns their own introductions", () => {
    const out = compose(["pet-a-dog", "stroke-horse-neck"], ["Mira"], [])
    expect(out).toContain("onto a dog's head")
    expect(out).toContain("high on a horse's neck")
    expect(out).not.toContain("that same dog")
  })

  /**
   * The definite-noun exemption is only REACHABLE on a second mention, and no
   * single entry mentions its definite counterpart twice — so a per-entry loop
   * of single picks asserts nothing: it passes with or without the branch.
   * These cases compose two picks that declare the SAME definite noun, which is
   * what puts a second mention in front of `laterReferenceTo`. Verified by
   * mutation: widen its regex to /^(?:another|an|a|the) (.+)$/ and this block
   * fails with "that same held object".
   */
  describe("a DEFINITE recipient noun repeats verbatim — it already names one referent", () => {
    /** Definite nouns declared by two or more entries — the only way to reach a second mention. */
    const definitePairs = [
      ...CHARACTER_MOTIONS.filter((m) => m.counterpart?.startsWith("the ")).reduce((byNoun, m) => {
        byNoun.set(m.counterpart!, [...(byNoun.get(m.counterpart!) ?? []), m.id])
        return byNoun
      }, new Map<string, string[]>()),
    ].filter(([, ids]) => ids.length > 1)

    it("has a repeatable definite noun to test — otherwise the cases below are vacuous", () => {
      expect(definitePairs.length).toBeGreaterThan(0)
    })

    it.each(definitePairs)("repeats %j on every mention across the picks that share it", (noun, ids) => {
      const picks = ids.slice(0, 3)
      const out = compose(picks, ["Mira"], [])
      const mentioned = picks.reduce((n, id) => n + mentions(hintOf(id)), 0)
      // Non-vacuity, asserted rather than assumed: this composition really does
      // put the noun in front of the composer more than once.
      expect(mentioned, `${noun} is mentioned once — the exemption is not exercised`).toBeGreaterThan(1)
      expect(out.match(new RegExp(noun, "g")), noun).toHaveLength(mentioned)
      expect(out, noun).not.toContain("that same")
    })

    it("spells the two-pick held-object case out in full", () => {
      expect(compose(["set-object-down", "hold-object-still"], ["Mira"], [])).toBe(
        "Mira lowers the held object onto the nearby supporting surface, releases it and draws both hands away, " +
          "then Mira keeps the held object steady in both hands without changing its orientation",
      )
    })

    it("rewrites an INDEFINITE noun in the very same two-pick shape", () => {
      // The contrast that proves the exemption is a real branch and not a
      // property of two-pick composition: same shape, indefinite noun, rewritten.
      expect(compose(["pet-a-dog", "offer-a-treat"], ["Mira"], [])).toContain("that same dog")
    })

    it("still repeats a definite noun verbatim in a single pick", () => {
      for (const entry of CHARACTER_MOTIONS.filter((m) => m.counterpart?.startsWith("the "))) {
        const out = compose(entry.id, ["Mira"], [])
        expect(out, entry.id).toContain(entry.counterpart!)
        expect(out, entry.id).not.toContain("that same")
      }
    })
  })
})
