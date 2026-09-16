/**
 * `endVisibility: "out-of-frame"` coverage.
 *
 * The annotation is ADVISORY input to `getCharacterMotionDiagnostics`: present,
 * it raises a "visibility" warning when a later move follows; absent, it raises
 * nothing. Absence is therefore missing information, never a claim that the
 * performer stays in shot — these tests assert what each entry DECLARES and
 * what the diagnostic reports, and nothing about what a model renders.
 */
import { describe, expect, it } from "vitest"
import { CHARACTER_MOTIONS, getCharacterMotion } from "../character-motion.js"
import { getCharacterMotionDiagnostics as diagnose } from "../character-motion-diagnostics.js"

/** Every entry whose authored text ends with the subject out of view. */
const DECLARED_EXITS = [
  // annotated from the start
  "walk-out-left",
  "walk-out-right",
  "run-out-of-frame",
  "back-out-of-frame",
  "exit-past-camera",
  "duck-out-of-frame",
  "exit-through-doorway",
  // added after an audit found their own text already said so
  "dragged-out-of-frame",
  "dash-across-frame",
  "walk-off-waving",
  "walk-past-camera",
  "lean-into-frame",
] as const

/**
 * Phrases that describe the performer leaving the frame. Used as a fail-closed
 * guard, not as a classifier: a NEW entry whose text matches has to either
 * declare the annotation or be added to EXIT_PHRASE_EXEMPT on purpose.
 *
 * WHAT IT DEFENDS. Every way the catalog and plausible new entries spell an
 * exit with a frame word: "off screen" / "off-screen" / "off camera";
 * "out of frame / shot / view / sight", with or without an article, which is
 * what defeats a bare /out of (frame|shot)/ pattern ("runs out of THE shot");
 * "leaves / exits the frame"; "disappears from view"; crossing an edge
 * ("below the bottom edge of the frame" — how `duck-out-of-frame` says it);
 * a trailing ", and is gone"; and the flat statements "no longer visible" and
 * "lost from sight". The positive table below pins each of those spellings, so
 * narrowing the pattern breaks a test rather than silently un-covering a class.
 *
 * WHAT IT DOES NOT DEFEND, and cannot without false positives here: an exit
 * stated only by its CONSEQUENCE, with no frame word at all — "steps behind the
 * pillar and is not seen again", "melts into the crowd", "recedes into the
 * darkness". The obvious pattern for those, /disappears into|is gone/, fires on
 * `apply-skincare` ("until it disappears into the skin") and `reel-in-leash`
 * ("until the slack is gone"), both of which stay in full view. An entry that
 * ends out of view and never says so in frame terms still needs a human to
 * annotate it; this scan will not catch it. The negative table pins those two
 * so a future widening cannot quietly re-break them.
 */
const EXIT_PHRASE = new RegExp([
  String.raw`\boff[ -]?(?:screen|frame|camera)\b`,
  String.raw`\bout[ -]of[ -](?:the[ -])?(?:frame|shot|screen|view|sight|camera)\b`,
  String.raw`\b(?:leave|leaves|leaving|exit|exits|exiting)\s+(?:the\s+)?(?:frame|shot|screen|view)\b`,
  String.raw`\b(?:disappear|vanish)(?:e?s|ing|ed)?\s+(?:from|off|out[ -]of)\s+(?:the\s+)?(?:frame|shot|screen|view|sight)\b`,
  String.raw`\b(?:below|past|beyond|through)\s+(?:the\s+)?(?:[\w-]+\s+){0,2}(?:edge|bottom|top|side)\s+of\s+(?:the\s+)?frame\b`,
  String.raw`\b(?:and|then)\s+is\s+gone\b`,
  String.raw`\b(?:no longer (?:visible|in (?:the )?(?:frame|shot|view))|(?:lost|hidden) from (?:view|sight))\b`,
  String.raw`\bgone out\b`,
  String.raw`\bexiting behind\b`,
  String.raw`\bout the far side\b`,
].join("|"), "i")

/**
 * "Off screen" as the thing LOOKED AT, not the place the performer went:
 * "an off-screen sound", "toward something off-frame", "gaze from off-frame".
 * Stripped before the scan rather than exempted by id, so the four entries that
 * use it — and any future one — pass without an exemption, while an entry that
 * says BOTH ("hears an off-screen shout and walks off screen") still trips the
 * guard on its second phrase. Deliberately narrow: only the attributive and
 * "from" forms, never a verb-distance heuristic, which would suppress
 * "looks back, then walks off screen".
 */
const LOOKED_AT = new RegExp([
  String.raw`\b(?:something|someone|somewhere|anything)\s+off[ -]?(?:screen|frame|camera)\b`,
  String.raw`\boff[ -]?(?:screen|frame|camera)\s+(?:sound|noise|voice|light|source|object|person|movement|motion|thing)\b`,
  String.raw`\bfrom\s+off[ -]?(?:screen|frame|camera)\b`,
].join("|"), "gi")

/** True when the text says the PERFORMER ends out of view. */
const scansAsExit = (text: string): boolean => EXIT_PHRASE.test(text.replace(LOOKED_AT, " "))

/**
 * Entries the phrase scan still matches although the SUBJECT ends in view. Each
 * is a genuine exception, not an oversight:
 *  - peek-into-frame     — the head holds in view; "the rest of the body" is
 *                          what stays out of frame.
 *  - look-off-screen-*   — "something out of frame" is the thing looked AT.
 *                          (The "off-screen" spelling of the same idea needs no
 *                          exemption — LOOKED_AT strips it — but these two say
 *                          "out of frame", which an exit says too.)
 */
const EXIT_PHRASE_EXEMPT = new Set(["peek-into-frame", "look-off-screen-left", "look-off-screen-right"])

describe("character motion — entries that declare an out-of-frame ending", () => {
  it("annotates every move whose text ends with the subject out of view", () => {
    for (const id of DECLARED_EXITS) {
      expect(getCharacterMotion(id)?.endVisibility, id).toBe("out-of-frame")
    }
  })

  // Deliberately NOT asserting that these twelve are the WHOLE set: a thirteenth
  // entry annotating itself correctly is the outcome we want, not a test failure.
  // The fail-closed guard below is what catches an entry that SHOULD annotate.

  it("fails closed on a new entry whose text uses an exit phrase", () => {
    const unannotated = CHARACTER_MOTIONS.filter(
      (m) =>
        (scansAsExit(m.promptHint) || scansAsExit(m.term ?? "")) &&
        m.endVisibility !== "out-of-frame" &&
        !EXIT_PHRASE_EXEMPT.has(m.id),
    ).map((m) => m.id)
    expect(unannotated, "annotate endVisibility, or add to EXIT_PHRASE_EXEMPT with a reason").toEqual([])
  })

  it("scans all twelve declared exits by phrase, not just by the pin above", () => {
    // The explicit list is a pin; this asserts the GUARD would have caught each
    // of them on its own, so the scan is demonstrably wide enough for the
    // phrasings the catalog actually uses.
    for (const id of DECLARED_EXITS) {
      const entry = getCharacterMotion(id)!
      expect(scansAsExit(`${entry.promptHint} ${entry.term ?? ""}`), id).toBe(true)
    }
  })
})

describe("character motion — what the exit-phrase scan does and does not catch", () => {
  // A heuristic that looks broad and is not is worse than a narrow one: these
  // two tables ARE the scan's contract. Shrink the pattern and the first fails;
  // widen it carelessly and the second does.
  it.each([
    "the subject walks off screen to the left",
    "the subject walks off-screen without looking back",
    "the subject leaves the frame at a jog",
    "the subject exits the shot",
    "the subject strides away until out of sight",
    "the subject runs out of the shot",
    "the subject backs out of frame",
    "the subject walks off camera",
    "the subject disappears from view behind the pillar",
    "the subject ducks below the bottom edge of the frame",
    "the subject edges sideways along the wall and slips off screen at the left, never looking back, and is gone",
    "the subject steps out the far side of the doorway",
    "the subject walks away and is no longer visible",
    "the subject slips into the alley, lost from sight",
  ])("catches an exit phrased as %j", (text) => {
    expect(scansAsExit(text)).toBe(true)
  })

  it.each([
    // The performer stays in view; something ELSE is off screen or gone.
    "the subject snaps the head toward an off-screen sound in one sharp turn",
    "slides the eyes hard to one side toward something off-frame without turning the head",
    "the subject lifts their gaze from off-frame and locks eyes straight into the lens",
    "the subject reacts to something off-screen then swings the gaze back to the lens",
    "walks a few paces forward to stop in clear view",
    "rubs it in with upward circles of the fingers until it disappears into the skin",
    "drawing it back to the hip until the slack is gone",
    "the subject leans the head and one shoulder into view from the right edge of the frame",
  ])("does not fire on %j", (text) => {
    expect(scansAsExit(text)).toBe(false)
  })
})

describe("character motion — the advisory visibility diagnostic", () => {
  it("warns when a declared exit is sequenced before another move", () => {
    for (const id of ["dragged-out-of-frame", "walk-off-waving", "walk-past-camera"]) {
      const warning = diagnose([id, "wave-hello"]).find((d) => d.code === "visibility")
      expect(warning?.severity, id).toBe("warning")
      expect(warning?.ids, id).toEqual([id, "wave-hello"])
    }
  })

  it("stays silent when the declared exit is last — nothing follows it", () => {
    expect(diagnose(["wave-hello", "walk-off-waving"]).some((d) => d.code === "visibility")).toBe(false)
  })
})
