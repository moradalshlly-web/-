import { describe, it, expect } from "vitest"
import type { Caption } from "@remotion/captions"
import {
  CAPTION_LINE_BREAK_GAP_MS,
  CAPTION_LINE_MAX_HOLD_MS,
  ACTIVE_WORD_GROWTH_EM,
  ACTIVE_WORD_MAX_SCALE,
  CAPTION_WORD_PAD_EM,
  activeCaptionLine,
  activeWordScale,
  captionCharWidthEm,
  captionLineCharBudget,
  groupCaptionLines,
} from "../caption-lines"

/** A word caption. `timestampMs`/`confidence` are required by the Caption type
 *  and ignored by every function under test. */
const w = (text: string, startMs: number, endMs: number): Caption =>
  ({ text, startMs, endMs, timestampMs: startMs, confidence: null })

const texts = (words: readonly Caption[]): string[] => words.map((c) => c.text.trim())

describe("captionCharWidthEm — conservative average advance per character", () => {
  // The calibration point: the default `outline` look is Montserrat 900
  // UPPERCASE, which a real production render measured at ~0.67 em/char. The
  // estimate must land ABOVE the measurement — overshooting drops one word off
  // a line, undershooting wraps the line in two (the bug this module kills).
  it("Montserrat 900 uppercase (the default outline look) ~= 0.72 em, never below the 0.67 measurement", () => {
    const em = captionCharWidthEm({ fontFamily: "Montserrat", fontWeight: 900, uppercase: true })
    expect(em).toBeCloseTo(0.72, 2)
    expect(em).toBeGreaterThanOrEqual(0.67)
  })
  it("an unknown / unset face takes the default", () => {
    expect(captionCharWidthEm({})).toBeCloseTo(0.56, 5)
    expect(captionCharWidthEm({ fontFamily: "Nonesuch" })).toBeCloseTo(0.56, 5)
    expect(captionCharWidthEm({ fontFamily: "Inter" })).toBeCloseTo(0.56, 5)
  })
  it("condensed faces are narrower, monospace wider", () => {
    expect(captionCharWidthEm({ fontFamily: "Bebas Neue" })).toBeLessThan(captionCharWidthEm({}))
    expect(captionCharWidthEm({ fontFamily: "Anton" })).toBeLessThan(captionCharWidthEm({}))
    expect(captionCharWidthEm({ fontFamily: "Roboto Mono" })).toBeGreaterThan(captionCharWidthEm({}))
    expect(captionCharWidthEm({ fontFamily: "Fira Code" })).toBeGreaterThan(captionCharWidthEm({}))
  })
  it("uppercase widens, and only 800+ weights pay the heavy-cut factor", () => {
    expect(captionCharWidthEm({ uppercase: true })).toBeCloseTo(0.56 * 1.15, 5)
    expect(captionCharWidthEm({ fontWeight: 700 })).toBeCloseTo(0.56, 5)
    expect(captionCharWidthEm({ fontWeight: 800 })).toBeCloseTo(0.56 * 1.06, 5)
    expect(captionCharWidthEm({ fontWeight: 900 })).toBeCloseTo(0.56 * 1.06, 5)
  })
})

describe("captionLineCharBudget", () => {
  it("the default outline look at 64px on a 1080-wide frame fits high-teens characters", () => {
    const budget = captionLineCharBudget({
      frameWidth: 1080, fontSize: 64, fontFamily: "Montserrat", fontWeight: 900, uppercase: true,
    })
    expect(budget).toBeGreaterThanOrEqual(15)
    expect(budget).toBeLessThan(20)
  })
  it("the clean look (Inter 700, mixed case) at 50px on a 1080-wide frame fits 30+", () => {
    const budget = captionLineCharBudget({ frameWidth: 1080, fontSize: 50, fontFamily: "Inter", fontWeight: 700 })
    expect(budget).toBeGreaterThanOrEqual(30)
  })
  it("the same font size fits fewer words on the heavy uppercase face than on the clean one", () => {
    const outline = captionLineCharBudget({ frameWidth: 1080, fontSize: 64, fontFamily: "Montserrat", fontWeight: 900, uppercase: true })
    const clean = captionLineCharBudget({ frameWidth: 1080, fontSize: 64, fontFamily: "Inter", fontWeight: 700 })
    expect(outline).toBeLessThan(clean)
  })
  it("a wider frame fits more", () => {
    const hd = captionLineCharBudget({ frameWidth: 1920, fontSize: 64, fontFamily: "Montserrat", fontWeight: 900, uppercase: true })
    const vertical = captionLineCharBudget({ frameWidth: 1080, fontSize: 64, fontFamily: "Montserrat", fontWeight: 900, uppercase: true })
    expect(hd).toBeGreaterThan(vertical)
  })
  it("never returns less than 6, even at an absurd font size", () => {
    expect(captionLineCharBudget({ frameWidth: 1080, fontSize: 2000 })).toBe(6)
  })
})

describe("groupCaptionLines", () => {
  it("a sentence-ending word closes the line", () => {
    const lines = groupCaptionLines([
      w("Same", 0, 200), w("shot.", 200, 400), w("No", 400, 600), w("re-prompting", 600, 800),
    ], 100)
    expect(lines.map((l) => texts(l.words))).toEqual([["Same", "shot."], ["No", "re-prompting"]])
  })
  it("a trailing quote or bracket still reads as a sentence end", () => {
    const lines = groupCaptionLines([w('done."', 0, 200), w("Next", 200, 400)], 100)
    expect(lines).toHaveLength(2)
  })
  it("a comma does NOT close a line", () => {
    const lines = groupCaptionLines([w("Same", 0, 200), w("face,", 200, 400), w("every", 400, 600)], 100)
    expect(lines).toHaveLength(1)
  })
  it("a pause of at least CAPTION_LINE_BREAK_GAP_MS closes the line", () => {
    const gap = CAPTION_LINE_BREAK_GAP_MS
    const closed = groupCaptionLines([w("one", 0, 200), w("two", 200 + gap, 400 + gap)], 100)
    expect(closed).toHaveLength(2)
    const open = groupCaptionLines([w("one", 0, 200), w("two", 200 + gap - 1, 400 + gap)], 100)
    expect(open).toHaveLength(1)
  })
  it("the character budget closes the line (words + one space between them)", () => {
    // "aaaa bbbb" = 9 chars; adding " cccc" would be 14 > 10.
    const lines = groupCaptionLines([w("aaaa", 0, 100), w("bbbb", 100, 200), w("cccc", 200, 300)], 10)
    expect(lines.map((l) => texts(l.words))).toEqual([["aaaa", "bbbb"], ["cccc"]])
  })
  it("a single word longer than the budget gets a line to itself", () => {
    const lines = groupCaptionLines([
      w("ok", 0, 100), w("extraordinarily", 100, 200), w("ok", 200, 300),
    ], 6)
    expect(lines.map((l) => texts(l.words))).toEqual([["ok"], ["extraordinarily"], ["ok"]])
  })
  it("captions with empty / whitespace-only text are skipped (no phantom word, no phantom break)", () => {
    const lines = groupCaptionLines([w("one", 0, 100), w("   ", 100, 150), w("two", 150, 300)], 100)
    expect(lines).toHaveLength(1)
    expect(texts(lines[0]!.words)).toEqual(["one", "two"])
  })
  it("an all-empty caption list produces no lines", () => {
    expect(groupCaptionLines([], 20)).toEqual([])
    expect(groupCaptionLines([w(" ", 0, 100)], 20)).toEqual([])
  })
  it("startMs / endMs span the line's first and last word", () => {
    const lines = groupCaptionLines([w("one", 40, 100), w("two.", 100, 320), w("three", 900, 1000)], 100)
    expect(lines[0]).toMatchObject({ startMs: 40, endMs: 320 })
    expect(lines[1]).toMatchObject({ startMs: 900, endMs: 1000 })
  })
  it("the leading-space delimiter form of @remotion/captions groups the same way", () => {
    const lines = groupCaptionLines([w("Same", 0, 200), w(" shot.", 200, 400), w(" No", 400, 600)], 100)
    expect(lines.map((l) => texts(l.words))).toEqual([["Same", "shot."], ["No"]])
  })
})

describe("groupCaptionLines — robust to the input a caller can actually send", () => {
  // The route validates no ordering and `endMs >= 0` only, so both of these
  // reach the render from a hand-built captions[].
  it("groups in TIME order, not array order (unsorted input used to vanish mid-word)", () => {
    const lines = groupCaptionLines([w("Hello.", 2000, 2300), w("world", 0, 400)], 100)
    expect(lines.map((l) => [l.startMs, texts(l.words)])).toEqual([[0, ["world"]], [2000, ["Hello."]]])
    // The word being spoken is on screen, and it is the highlighted one.
    const hit = activeCaptionLine(lines, 2100)
    expect(hit && texts(hit.line.words)).toEqual(["Hello."])
  })
  it("an out-of-order word inside a phrase is highlighted at ITS time", () => {
    const lines = groupCaptionLines([w("A", 0, 300), w("C", 700, 1000), w("B", 400, 600)], 100)
    expect(texts(lines[0]!.words)).toEqual(["A", "B", "C"])
    const hit = activeCaptionLine(lines, 800)
    expect(hit && hit.line.words[hit.activeIndex]!.text).toBe("C")
  })
  it("does not mutate the caller's array", () => {
    const input = [w("b", 500, 600), w("a", 0, 100)]
    groupCaptionLines(input, 100)
    expect(input.map((c) => c.text)).toEqual(["b", "a"])
  })
  it("one bad endMs on a line's last word does not blank the whole line", () => {
    // insanely-fast-whisper emits timestamp [start, null] for a final chunk cut
    // mid-word, which maps to endMs 0; a caller can also just send endMs: 0.
    const lines = groupCaptionLines([w("Thank", 9000, 9300), w("you", 9300, 9500), w("bye", 9500, 0)], 100)
    expect(lines[0]).toMatchObject({ startMs: 9000, endMs: 9500 })
    for (const ms of [9000, 9100, 9400, 9600]) expect(activeCaptionLine(lines, ms)).not.toBeNull()
  })
  it("a line ends at the LATEST word end, so an overlapping short word cannot cut the hold short", () => {
    const lines = groupCaptionLines([w("A", 0, 2000), w("B", 100, 300)], 100)
    expect(lines[0]!.endMs).toBe(2000)
    expect(activeCaptionLine(lines, 1900)).not.toBeNull()
  })
})

describe("groupCaptionLines — widow control (a phrase split for width is rebalanced)", () => {
  // Contiguous word timings (no pause) so only the char budget can break a line.
  const phrase = (...ws: string[]): Caption[] => ws.map((t, i) => w(t, i * 200, (i + 1) * 200))

  it("pulls a word down so the tail of a phrase is not stranded alone", () => {
    // Greedy at 19: "Same face, every" (16) / "shot." (5) — a one-word widow.
    const lines = groupCaptionLines(phrase("Same", "face,", "every", "shot."), 19)
    expect(lines.map((l) => texts(l.words))).toEqual([["Same", "face,"], ["every", "shot."]])
    // The lower line now STARTS at the moved word (its timing came with it).
    expect(lines[1]!.startMs).toBe(400)
    expect(lines[0]!.endMs).toBe(400)
  })
  it("settles a three-line phrase bottom-up in one pass, every line within budget", () => {
    const lines = groupCaptionLines(phrase("73", "characters,", "and", "the", "face", "doesn't", "drift."), 19)
    expect(lines.map((l) => texts(l.words))).toEqual([["73", "characters,"], ["and", "the", "face"], ["doesn't", "drift."]])
    for (const l of lines) expect(texts(l.words).join(" ").length).toBeLessThanOrEqual(19)
  })
  it("only moves a word when the pair gets MORE balanced (an even split is left alone)", () => {
    const lines = groupCaptionLines(phrase("aaaa", "bbbb", "cccc"), 10)
    expect(lines.map((l) => texts(l.words))).toEqual([["aaaa", "bbbb"], ["cccc"]])
  })
  it("never moves a word across a sentence end or a pause — those breaks are the speaker's", () => {
    // "shot." ends the sentence; "No" must stay alone rather than borrow from it.
    const sentence = groupCaptionLines(phrase("Same", "face,", "every", "shot.", "No"), 100)
    expect(sentence.map((l) => texts(l.words))).toEqual([["Same", "face,", "every", "shot."], ["No"]])
    const paused = groupCaptionLines([w("one", 0, 100), w("two", 100, 200), w("three", 900, 1000)], 100)
    expect(paused.map((l) => texts(l.words))).toEqual([["one", "two"], ["three"]])
  })
  it("never empties the upper line and never overfills the lower one", () => {
    const lines = groupCaptionLines(phrase("extraordinarily", "ok"), 15)
    expect(lines.map((l) => texts(l.words))).toEqual([["extraordinarily"], ["ok"]])
  })
})

describe("activeCaptionLine", () => {
  const lines = groupCaptionLines([
    w("one", 0, 200), w("two", 400, 600),   // line 1: 0-600 (no break between them)
    w("three", 2000, 2200),                 // line 2: 2000-2200 (gap >= 500 closes line 1)
  ], 100)

  it("groups the fixture into the two expected lines", () => {
    expect(lines.map((l) => texts(l.words))).toEqual([["one", "two"], ["three"]])
  })
  it("is null before the first word", () => {
    expect(activeCaptionLine(lines, -1)).toBeNull()
  })
  it("is live from the first word's startMs, with the first word active", () => {
    expect(activeCaptionLine(lines, 0)).toMatchObject({ activeIndex: 0 })
  })
  it("holds the line through an INTRA-line gap, last-spoken word still active", () => {
    // 200-400 is a pause inside line 1: the old per-word overlay rendered nothing.
    const hit = activeCaptionLine(lines, 300)
    expect(hit).not.toBeNull()
    expect(texts(hit!.line.words)).toEqual(["one", "two"])
    expect(hit!.activeIndex).toBe(0)
  })
  it("advances the highlight at the next word's startMs", () => {
    expect(activeCaptionLine(lines, 400)!.activeIndex).toBe(1)
    expect(activeCaptionLine(lines, 399)!.activeIndex).toBe(0)
  })
  it("holds the line through an INTER-line gap until the next line starts", () => {
    const held = activeCaptionLine(lines, 1200)
    expect(texts(held!.line.words)).toEqual(["one", "two"])
    expect(held!.activeIndex).toBe(1) // last-spoken word stays lit
  })
  it("the next line takes over exactly at its startMs", () => {
    expect(texts(activeCaptionLine(lines, 1999)!.line.words)).toEqual(["one", "two"])
    expect(texts(activeCaptionLine(lines, 2000)!.line.words)).toEqual(["three"])
  })
  it("blanks only once past endMs + CAPTION_LINE_MAX_HOLD_MS (trailing silence)", () => {
    const last = lines[lines.length - 1]!
    expect(activeCaptionLine(lines, last.endMs + CAPTION_LINE_MAX_HOLD_MS)).not.toBeNull()
    expect(activeCaptionLine(lines, last.endMs + CAPTION_LINE_MAX_HOLD_MS + 1)).toBeNull()
  })
  it("the hold cap applies to EVERY line, not just the last — a long inter-line silence clears", () => {
    // A 2 s gap is longer than the hold, so the caption blanks in the middle of
    // it and comes back when the next line starts. (The fixture above only has
    // a 1.4 s inter-line gap, which the hold bridges — this pins the boundary.)
    const spaced = groupCaptionLines([w("one", 0, 1000), w("two", 3000, 3500)], 100)
    expect(spaced).toHaveLength(2)
    expect(activeCaptionLine(spaced, 1000 + CAPTION_LINE_MAX_HOLD_MS)).not.toBeNull()
    expect(activeCaptionLine(spaced, 1000 + CAPTION_LINE_MAX_HOLD_MS + 1)).toBeNull()
    expect(activeCaptionLine(spaced, 2999)).toBeNull()
    expect(texts(activeCaptionLine(spaced, 3000)!.line.words)).toEqual(["two"])
  })
  it("an empty line list is always null", () => {
    expect(activeCaptionLine([], 0)).toBeNull()
  })
})

// Regression: the real 25 s clip that reported "captions blank between words".
// These are its actual first words and timings; the pauses at 620-840, 1400-1780
// and 2500-3080 ms are where the per-word overlay rendered nothing.
describe("no blank frame on a real word-timed clip", () => {
  const CLIP: Caption[] = [
    w("Same", 0, 340),
    w("face,", 340, 620),
    w("every", 840, 1080),
    w("shot.", 1080, 1400),
    w("No", 1780, 1880),
    w("re-prompting.", 1880, 2500),
    w("Ok", 3080, 3280),
    w("so", 3400, 3460),
    w("I", 3460, 3660),
  ]
  // The default outline look at 64px on a 1080-wide frame.
  const budget = captionLineCharBudget({
    frameWidth: 1080, fontSize: 64, fontFamily: "Montserrat", fontWeight: 900, uppercase: true,
  })
  const lines = groupCaptionLines(CLIP, budget)

  it("renders SOMETHING at every sampled ms from the first word to the last (no blank frame)", () => {
    const blanks: number[] = []
    for (let ms = 0; ms <= 3660; ms += 20) {
      if (activeCaptionLine(lines, ms) === null) blanks.push(ms)
    }
    expect(blanks).toEqual([])
  })
  it('the 60 ms word "so" never causes a blank, and never owns a line of its own mid-phrase', () => {
    for (let ms = 3400; ms <= 3460; ms += 5) {
      const hit = activeCaptionLine(lines, ms)
      expect(hit, `blank at ${ms}ms`).not.toBeNull()
      expect(texts(hit!.line.words)).toContain("so")
    }
  })
  it("every line fits the character budget", () => {
    for (const line of lines) {
      const chars = texts(line.words).join(" ").length
      // A single word longer than the budget is the one allowed overflow.
      if (line.words.length > 1) expect(chars, texts(line.words).join(" ")).toBeLessThanOrEqual(budget)
    }
  })
  it("closes a line on the sentence end and on the 580 ms pause, with no one-word widow", () => {
    // "shot." ends a sentence (next line starts at "No", 1780); 2500 -> 3080 is a
    // 580 ms pause (next line starts at "Ok"). Widow control keeps "shot." WITH
    // "every" (line starting 840) instead of stranding it on a line at 1080.
    const starts = lines.map((l) => l.startMs)
    expect(starts).toContain(1780)
    expect(starts).toContain(3080)
    expect(starts).not.toContain(1080)
    expect(lines.map((l) => texts(l.words))).toContainEqual(["every", "shot."])
  })
})

describe("activeWordScale — the highlight pop can never close the gap to a neighbour", () => {
  // A CSS scale() reserves no layout space, and the only thing between two words
  // is a ~0.25 em space glyph. Production render, 2026-09-18: "No re-prompting."
  // read "Nore-prompting." — and a first fix that budgeted the growth in average
  // CHARACTERS (~0.56 em) instead of against the space still left a ~4 px gap.
  // Verified on rendered frames: scale off → normal space; this rule → normal space.
  const boxEm = (text: string, m = {}) => text.trim().length * captionCharWidthEm(m) + 0.25 + 2 * CAPTION_WORD_PAD_EM

  it("a very short word keeps the full pop", () => {
    expect(activeWordScale("No")).toBe(ACTIVE_WORD_MAX_SCALE)
  })
  it("the word from the bug report tapers to ~1.04", () => {
    expect(activeWordScale("re-prompting.", { fontFamily: "Inter", fontWeight: 700 })).toBeCloseTo(1.0414, 3)
  })
  it("the growth per side never exceeds ACTIVE_WORD_GROWTH_EM — any length, any face", () => {
    const faces = [{}, { fontFamily: "Montserrat", fontWeight: 900, uppercase: true }, { fontFamily: "Bebas Neue" }, { fontFamily: "Roboto Mono" }]
    for (const m of faces) {
      for (let len = 1; len <= 40; len++) {
        const word = "x".repeat(len)
        const perSideEm = ((activeWordScale(word, m) - 1) / 2) * boxEm(word, m)
        expect(perSideEm).toBeLessThanOrEqual(ACTIVE_WORD_GROWTH_EM + 1e-9)
      }
    }
  })
  it("the gap left while a word is popped is at least a normal space", () => {
    // resting gap = space glyph + both paddings; the pop may take GROWTH_EM of it.
    const restingGapEm = 0.25 + 2 * CAPTION_WORD_PAD_EM
    expect(restingGapEm - ACTIVE_WORD_GROWTH_EM).toBeGreaterThanOrEqual(0.25)
  })
  it("a wider face tapers sooner (same word, bigger box)", () => {
    const heavy = activeWordScale("workspace.", { fontFamily: "Montserrat", fontWeight: 900, uppercase: true })
    const light = activeWordScale("workspace.", { fontFamily: "Inter", fontWeight: 700 })
    expect(heavy).toBeLessThan(light)
  })
  it("measures the TRIMMED word, never shrinks, and leaves an empty word alone", () => {
    expect(activeWordScale(" re-prompting.")).toBe(activeWordScale("re-prompting."))
    expect(activeWordScale("x".repeat(500))).toBeGreaterThan(1)
    expect(activeWordScale("")).toBe(1)
    expect(activeWordScale("   ")).toBe(1)
  })
})
