import { describe, it, expect, vi } from "vitest"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Caption } from "@remotion/captions"

/**
 * What is ON SCREEN at a given millisecond, for the overlays that render a UNIT
 * of the transcript rather than the whole of it. Two bugs live here and both are
 * only visible in a rendered frame:
 *   - karaoke and bouncy used to paint the ENTIRE transcript as one block (a
 *     wall of text on a 25 s clip, with a sweep nobody can follow),
 *   - word-pop and tiktok-words went BLANK in the gaps between their units.
 */
const clock = vi.hoisted(() => ({ frame: 0 }))
const FPS = 30

// `importOriginal` keeps the REAL `interpolate` / `spring`, so the overlays are
// exercised against the production math, not a hand-rolled stand-in.
vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: FPS, width: 1080, height: 1920, durationInFrames: 900 }),
}))

// eslint-disable-next-line import/first
import { KaraokeOverlay } from "../karaoke-overlay"
// eslint-disable-next-line import/first
import { BouncyOverlay } from "../bouncy-overlay"
// eslint-disable-next-line import/first
import { WordPopOverlay } from "../word-pop-overlay"
// eslint-disable-next-line import/first
import { TikTokPagesOverlay } from "../tiktok-pages-overlay"
// eslint-disable-next-line import/first
import { WordHighlightOverlay } from "../word-highlight-overlay"
// eslint-disable-next-line import/first
import { SubtitleOverlay, type OverlayCommonProps } from "../subtitle-overlay"

const w = (text: string, startMs: number, endMs: number): Caption =>
  ({ text, startMs, endMs, timestampMs: startMs, confidence: null })

/** Render the overlay as it paints on a given FRAME — the unit the render walks
 *  in, so a frame that lands between two whole ms (the last frame of a clip) can
 *  be addressed exactly. */
const renderAtFrame = (frame: number, element: ReactElement): string => {
  clock.frame = frame
  return renderToStaticMarkup(element)
}

/** Render the overlay as it paints at `ms`. Every ms used below is an exact
 *  multiple of the 30 fps frame duration, so no rounding creeps in. */
const renderAt = (ms: number, element: ReactElement): string =>
  renderAtFrame(Math.round((ms / 1000) * FPS), element)

/** Two sentences separated by a 700 ms pause — the line grouping must split
 *  them, and at 40px on a 1080 frame each sentence fits one line (20 / 14 chars
 *  against a ~40-char budget). */
const TWO_SENTENCES: Caption[] = [
  w("The", 0, 300), w("quick", 300, 700), w("brown", 700, 1100), w("fox.", 1100, 1500),
  w("Jumps", 2200, 2600), w("over", 2600, 3000), w("it.", 3000, 3400),
]

/** One run: no sentence end, no pause. Only a word cap can break it. */
const ONE_RUN: Caption[] = [w("one", 0, 300), w("two", 300, 600), w("three", 600, 900), w("four", 900, 1200)]

const LINE_OVERLAYS = [
  ["KaraokeOverlay", KaraokeOverlay],
  ["BouncyOverlay", BouncyOverlay],
] as const

describe.each(LINE_OVERLAYS)("%s renders ONE held line, not the whole transcript", (_name, Overlay) => {
  const render = (ms: number, maxWordsPerLine?: number): string =>
    renderAt(ms, <Overlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" maxWordsPerLine={maxWordsPerLine} />)

  it("paints only the sentence being spoken", () => {
    const html = render(500)
    expect(html).toContain("quick")
    expect(html).toContain("fox.")
    expect(html).not.toContain("Jumps")
    expect(html).not.toContain("it.")
  })

  it("hands over to the next line at its first word", () => {
    const html = render(2400)
    expect(html).toContain("Jumps")
    expect(html).not.toContain("quick")
  })

  it("holds the line through the 700 ms pause between the two sentences", () => {
    const html = render(1800)
    expect(html).toContain("fox.")
    expect(html).not.toContain("Jumps")
  })

  it("honours maxWordsPerLine (2 words, so 'brown fox.' is a later line)", () => {
    const html = render(500, 2)
    expect(html).toContain("quick")
    expect(html).not.toContain("brown")
  })
})

describe("KaraokeOverlay keeps its per-word sweep inside the held line", () => {
  it("wipes the word being spoken and leaves the rest of the line unfilled", () => {
    // 500 ms is 200 into "quick"'s [300, 700] window → 50 % filled, 50 % clipped.
    const html = renderAt(500, <KaraokeOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" />)
    expect(html).toContain("inset(0 50% 0 0)")
    // "The" is already spoken (fully revealed) and "brown" has not started.
    expect(html).toContain("inset(0 0% 0 0)")
    expect(html).toContain("inset(0 100% 0 0)")
  })
  it("animate:false is still a discrete per-word fill", () => {
    const html = renderAt(500, <KaraokeOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" animate={false} />)
    expect(html).not.toContain("inset(0 50% 0 0)")
    expect(html).toContain("inset(0 0% 0 0)")
  })
})

describe("BouncyOverlay keeps its per-word bounce inside the held line", () => {
  it("the word that just started is translated, the settled ones are not", () => {
    // 300 ms is "quick"'s own startMs → its spring is at frame 0 (dy = -20px).
    const html = renderAt(300, <BouncyOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" />)
    expect(html).toContain("translateY(-20px)")
    expect(html).toContain("translateY(0px)")
  })
  it("animate:false leaves every word at rest", () => {
    const html = renderAt(300, <BouncyOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" animate={false} />)
    expect(html).not.toMatch(/translateY\((?!0px\))/)
    expect(html).toContain("translateY(0px)")
  })
})

describe("WordPopOverlay holds the last-started word across an inter-word gap", () => {
  const render = (ms: number): string =>
    renderAt(ms, <WordPopOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" />)

  it("shows the word during its own window", () => {
    expect(render(400)).toContain("quick")
  })
  it("still shows the previous word INSIDE the 700 ms gap (it used to render nothing)", () => {
    const html = render(1800)
    expect(html).toContain("fox.")
    expect(html).not.toContain("Jumps")
  })
  it("the pop spring still fires from each word's OWN start, not the line's", () => {
    const scaleAt = (ms: number): number => Number(/scale\(([\d.]+)\)/.exec(render(ms))![1])
    // "it." starts at 3000: its spring is at frame 0 there (scale 0) and has
    // settled by 4500 — a held word does not re-pop, and the word BEFORE it
    // ("over", 2600) is already settled when "it." has not started yet.
    expect(scaleAt(3000)).toBe(0)
    expect(scaleAt(4500)).toBeGreaterThan(0.99)
    expect(scaleAt(2900)).toBeGreaterThan(0.99)
  })
  it("animate:false yields scale 1 with no spring", () => {
    const html = renderAt(3000, <WordPopOverlay captions={TWO_SENTENCES} position="bottom" fontSize={40} color="#ffffff" animate={false} />)
    expect(html).toContain("scale(1)")
  })
  it("clears once the silence outlasts the hold cap", () => {
    expect(render(5200)).toBe("")
  })
})

describe("TikTokPagesOverlay pages within a run, never across a breath", () => {
  // "Go now." then a 700 ms pause and a second sentence. All four words fall
  // inside the 1200 ms combine window, so paging the list in ONE call put the
  // full stop AND the pause in the middle of a page.
  const PAUSED: Caption[] = [w("Go", 0, 200), w("now.", 200, 500), w("Then", 1200, 1500), w("stop.", 1500, 1800)]
  const render = (ms: number, captions: Caption[], maxWordsPerLine?: number): string =>
    renderAt(ms, <TikTokPagesOverlay captions={captions} position="bottom" fontSize={40} color="#ffffff" maxWordsPerLine={maxWordsPerLine} />)

  it("breaks the page at the sentence end / pause", () => {
    const html = render(300, PAUSED)
    expect(html).toContain("Go now.")
    expect(html).not.toContain("Then")
  })
  it("holds the page across the pause instead of blanking", () => {
    const html = render(800, PAUSED)
    expect(html).toContain("Go now.")
    expect(html).not.toContain("Then")
  })
  it("holds the LAST page past its final token (it used to end exactly there)", () => {
    expect(render(2000, PAUSED)).toContain("Then stop.")
    // …but not for ever: the hold cap clears it.
    expect(render(3400, PAUSED)).toBe("")
  })
  it("breaks the page at maxWordsPerLine", () => {
    const html = render(400, ONE_RUN, 2)
    expect(html).toContain("one two")
    expect(html).not.toContain("three")
  })
  it("with no cap the run pages as before (the 1200 ms combine window alone)", () => {
    expect(render(400, ONE_RUN)).toContain("one two three four")
  })
  it("keeps the token-level spoken highlight inside the capped page", () => {
    const html = renderAt(400, <TikTokPagesOverlay captions={ONE_RUN} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" maxWordsPerLine={2} />)
    // Two token spans; the second ("two", started at 300) carries the highlight.
    expect(html).toContain(">one</span>")
    expect(html).toContain("color:#FFE600")
    expect(html).toMatch(/one<\/span> <span[^>]*>two<\/span>/)
  })
  it("the page still springs in from its OWN start", () => {
    // At the page's startMs the spring is at frame 0 → 0.9 + 0 * 0.1.
    expect(render(0, ONE_RUN, 2)).toContain("scale(0.9)")
  })
  it("animate:false drops the enter-spring (the page sits at its final scale)", () => {
    const html = renderAt(0, <TikTokPagesOverlay captions={ONE_RUN} position="bottom" fontSize={40} color="#ffffff" animate={false} />)
    expect(html).toContain("scale(1)")
  })
})

/**
 * A caption render has NO error boundary: one `interpolate` / `spring` throw
 * fails the whole job, after the credits are reserved and the transcription is
 * paid for. These word windows all reach the overlays in production —
 *   - a final transcription chunk cut mid-word maps to `endMs: 0`,
 *   - `apply-edl` emits zero-width words on purpose,
 *   - `captions[]` from the API is validated for `>= 0` only, never for
 *     `endMs > startMs`,
 * — so the overlays must DEGRADE (draw the unit without its animation), never
 * throw. Rendered on the DEFAULT animate path: `animate: false` skips the math
 * entirely and would not discriminate.
 */
const DEGENERATE: [string, Caption[], number][] = [
  ["a final chunk cut mid-word (endMs 0)", [w("Thank", 9000, 9300), w(" you", 9300, 9500), w(" bye", 9500, 0)], 9500],
  ["a lone zero-length word", [w("hi", 1000, 1000)], 1000],
  ["a zero-length word mid-line", [w("a", 0, 300), w(" b", 300, 300), w(" c", 300, 600)], 300],
  ["an inverted word mid-line", [w("a", 0, 300), w(" b", 300, 100), w(" c", 300, 600)], 300],
  ["a start that is not a number", [w("Same", 0, 300), w(" face", Number.NaN, 700)], 300],
  ["a lone word whose start is not a number", [w("hi", Number.NaN, 500)], 0],
]

const ALL_CAPTION_OVERLAYS = [
  ["SubtitleOverlay", SubtitleOverlay],
  ["WordHighlightOverlay", WordHighlightOverlay],
  ["KaraokeOverlay", KaraokeOverlay],
  ["TikTokPagesOverlay", TikTokPagesOverlay],
  ["WordPopOverlay", WordPopOverlay],
  ["BouncyOverlay", BouncyOverlay],
] as const

describe.each(ALL_CAPTION_OVERLAYS)("%s degrades on a malformed word window", (_name, Overlay) => {
  it.each(DEGENERATE)("renders %s without throwing", (_case, captions, ms) => {
    let html = ""
    expect(() => {
      html = renderAt(ms, <Overlay captions={captions} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" />)
    }).not.toThrow()
    // Degrading means the caption is still ON SCREEN — the hold rule keeps the
    // line/word up, so a silent empty render would be the other half of the bug.
    expect(html).not.toBe("")
  })
})

describe("KaraokeOverlay falls back to the discrete fill on a window that cannot sweep", () => {
  // The fast-whisper tail: " bye" arrives as [9500, 0]. interpolate throws on
  // that range, so the sweep is replaced by the animate:false semantics —
  // unspoken until its startMs, fully filled from it.
  const TAIL_CUT = [w("Thank", 9000, 9300), w(" you", 9300, 9500), w(" bye", 9500, 0)]
  const render = (ms: number): string =>
    renderAt(ms, <KaraokeOverlay captions={TAIL_CUT} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" />)

  it("leaves it fully unfilled before its start, while the well-formed words still sweep", () => {
    const html = render(9400)
    expect(html).toContain("inset(0 100% 0 0)") // " bye" has not started
    expect(html).toContain("inset(0 50% 0 0)")  // " you" is mid-sweep, unaffected
  })

  it("fills it the instant it starts", () => {
    const html = render(9500)
    expect(html).not.toContain("inset(0 100% 0 0)")
    expect(html).toContain("inset(0 0% 0 0)")
  })
})

describe("mixed-direction rows — the delimiter belongs to the row, the word to its box", () => {
  // A Hebrew clip that opens with a brand name: the row reads RTL (majority),
  // and the space between a Latin box and a Hebrew box falls BETWEEN them.
  // Inside a directional inline-block the leading space sat on the box's own
  // start side — the wrong side in a mixed row — so the words rendered glued.
  const hebrewWithBrand: Caption[] = [
    { text: "Nodaro", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
    { text: " זה", startMs: 500, endMs: 900, timestampMs: 500, confidence: null },
    { text: " הכלי", startMs: 900, endMs: 1400, timestampMs: 900, confidence: null },
    { text: " הכי", startMs: 1400, endMs: 1800, timestampMs: 1400, confidence: null },
    { text: " טוב", startMs: 1800, endMs: 2400, timestampMs: 1800, confidence: null },
  ]
  const overlays = [
    ["WordHighlightOverlay", (p: OverlayCommonProps) => <WordHighlightOverlay {...p} />],
    ["KaraokeOverlay", (p: OverlayCommonProps) => <KaraokeOverlay {...p} />],
    ["BouncyOverlay", (p: OverlayCommonProps) => <BouncyOverlay {...p} />],
    ["TikTokPagesOverlay", (p: OverlayCommonProps) => <TikTokPagesOverlay {...p} highlightColor="#FFE600" />],
  ] as const

  it.each(overlays)("%s: the row is rtl for a Hebrew list that opens with a Latin token", (_name, make) => {
    const html = renderAtFrame(20, make({ captions: hebrewWithBrand, position: "bottom", fontSize: 40, color: "#fff" }))
    expect(html).toMatch(/<div[^>]*direction:rtl/)
  })

  it.each(overlays)("%s: no word box carries the delimiter — it is a row text node between boxes", (_name, make) => {
    const html = renderAtFrame(20, make({ captions: hebrewWithBrand, position: "bottom", fontSize: 40, color: "#fff" }))
    // No span text starts with a space…
    expect(html).not.toMatch(/<span[^>]*>\s+[^<\s]/)
    // …and consecutive word boxes are separated by exactly one space text node.
    expect(html).toMatch(/Nodaro<\/span>(<\/span>)? <span/)
  })
})

describe("TikTokPagesOverlay takes its row direction from the WHOLE caption list", () => {
  // A Hebrew piece whose second page opens with a Latin brand token. Detecting
  // the direction from the ACTIVE PAGE flipped that page to ltr and its
  // inline-block tokens then read in reversed order; the whole list is the
  // language of the piece, which is the rule the other overlays use.
  const HEBREW: Caption[] = [
    w("שלום", 0, 400), w("לכולם.", 400, 800),
    w("Nodaro", 1400, 1800), w("מצוין", 1800, 2200),
  ]
  // No highlightColor on purpose: with one, each token carries its OWN
  // directionStyle and the Hebrew tokens would put "direction:rtl" in the markup
  // whatever the row does. Without it the page is one plain string, so the only
  // direction in the output is the row's.
  const render = (ms: number): string =>
    renderAt(ms, <TikTokPagesOverlay captions={HEBREW} position="bottom" fontSize={40} color="#ffffff" />)

  it("lays the Latin-opening page out RTL", () => {
    const html = render(1600)
    expect(html).toContain("Nodaro")
    expect(html).toContain("direction:rtl")
    expect(html).not.toContain("direction:ltr")
  })

  it("and still lays the Hebrew-opening page out RTL", () => {
    const html = render(200)
    expect(html).toContain("direction:rtl")
    expect(html).not.toContain("direction:ltr")
  })
})

describe("SubtitleOverlay renders a static text block for the whole clip", () => {
  // `text` on a `subtitle` is ONE Caption spanning the video, with "\n" as a
  // forced break. With no word cap it must stay one block — never time-split
  // into pages — and be on screen from the first frame to the last.
  const BLOCK: Caption[] = [w("line one\nline two", 0, 30000)]
  const render = (frame: number): string =>
    renderAtFrame(frame, <SubtitleOverlay captions={BLOCK} position="bottom" fontSize={40} color="#ffffff" />)

  // frame 899 is the last of the 900-frame (30 s) composition this file mocks.
  it.each([["first", 0], ["middle", 450], ["last", 899]])("is up on the %s frame", (_when, frame) => {
    const html = render(frame)
    expect(html).toContain("line one\nline two")
    // pre-line is what turns the caller's "\n" into the forced break.
    expect(html).toContain("white-space:pre-line")
  })

  it("stays ONE block — the text is rendered once, not split into timed pages", () => {
    expect(render(450).split("line two")).toHaveLength(2)
  })
})

describe("WordHighlightOverlay honours maxWordsPerLine", () => {
  it("caps the line at 2 words", () => {
    const html = renderAt(400, <WordHighlightOverlay captions={ONE_RUN} position="bottom" fontSize={40} color="#ffffff" maxWordsPerLine={2} />)
    expect(html).toContain("one")
    expect(html).toContain("two")
    expect(html).not.toContain("three")
    expect(html).not.toContain("four")
  })
  it("with no cap the whole run fits one line at this size", () => {
    const html = renderAt(400, <WordHighlightOverlay captions={ONE_RUN} position="bottom" fontSize={40} color="#ffffff" />)
    expect(html).toContain("four")
  })
})

// A PHRASE-level entry — one Caption whose text is a whole phrase — used to
// render on the kinetic styles as ONE atomic `white-space: pre` inline-block:
// a box wider than the frame, cut off at both edges (staging frame, 2026-09-22:
// "No re-prompti", "Same wor"). The width budget closed lines BETWEEN entries
// and never split one. `splitToWidth` is the gate, and WHICH overlays pass it is
// the invariant: the three that paint atomic word boxes do, the subtitle — which
// joins the line into one `white-space: pre-line` string the browser really
// wraps, and deliberately shows a segment's words as one block — does not.
describe("a phrase entry wider than the line budget", () => {
  // 49 chars against the ~40-char budget at 40px on a 1080 frame.
  const PHRASE: Caption[] = [w("the quick brown fox jumps over the lazy dog today", 0, 3000)]
  const SPLITTING = [
    ["WordHighlightOverlay", WordHighlightOverlay],
    ["KaraokeOverlay", KaraokeOverlay],
    ["BouncyOverlay", BouncyOverlay],
  ] as const

  describe.each(SPLITTING)("%s splits it into lines that fit", (_name, Overlay) => {
    const render = (ms: number): string =>
      renderAt(ms, <Overlay captions={PHRASE} position="bottom" fontSize={40} color="#ffffff" />)

    it("shows only the first sub-phrase while it is being spoken", () => {
      const html = render(500)
      expect(html).toContain("the quick brown fox")
      expect(html).not.toContain("today")
    })

    it("hands over to the rest of the phrase later in the same entry's span", () => {
      const html = render(2600)
      expect(html).toContain("today")
      expect(html).not.toContain("quick")
    })
  })

  it("SubtitleOverlay keeps the whole phrase as one wrapping block (it must NOT split)", () => {
    const html = renderAt(500, <SubtitleOverlay captions={PHRASE} position="bottom" fontSize={40} color="#ffffff" />)
    expect(html).toContain("the quick brown fox jumps over the lazy dog today")
    expect(html).toContain("white-space:pre-line")
  })

  it("a caller-authored \\n block is never re-cut, even on a splitting overlay", () => {
    const block: Caption[] = [w("SALE ENDS FRIDAY\nFree shipping on everything we sell", 0, 30000)]
    const html = renderAt(500, <WordHighlightOverlay captions={block} position="bottom" fontSize={40} color="#ffffff" />)
    expect(html).toContain("SALE ENDS FRIDAY\nFree shipping on everything we sell")
  })
})
