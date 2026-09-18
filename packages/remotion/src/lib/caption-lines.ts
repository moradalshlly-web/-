import type { Caption } from "@remotion/captions"
import type { SupportedFontName } from "@nodaro/shared"

/**
 * Grouping word-timed captions into LINES, and picking the line that is on
 * screen at a given ms.
 *
 * Why this exists: a word-level overlay that keys visibility off each word's
 * own [startMs, endMs] goes BLANK in every inter-word pause — on a real 25 s
 * clip with 580-720 ms pauses, 37 of 125 sampled frames rendered nothing. A
 * line is the unit a viewer reads, so the line stays up through the gaps and
 * only the HIGHLIGHT moves word to word (the CapCut read).
 *
 * Deliberately PURE — no React, no DOM, no measurement. `@remotion/layout-utils`
 * is not installed here, and a deterministic estimate has the second virtue of
 * producing the identical grouping in the render worker and in the canvas
 * preview (a DOM measurement would not, and the two would drift apart).
 */

/** A run of adjacent words that share one on-screen line. */
export interface CaptionLine {
  readonly words: readonly Caption[]
  /** First word's startMs — when the line takes over the screen. */
  readonly startMs: number
  /** Last word's endMs — when the line stops being *spoken* (not when it hides). */
  readonly endMs: number
}

/**
 * Target line width as a fraction of the frame. The overlay's row container
 * spans 90 % (left/right 5 %), so 85 % leaves a margin for the estimate being
 * off on an unusually wide string rather than wrapping to a second line.
 */
export const CAPTION_LINE_WIDTH_FRACTION = 0.85

/** A pause at least this long between two words closes the line — a breath is
 *  where a reader expects the text to turn over. */
export const CAPTION_LINE_BREAK_GAP_MS = 500

/**
 * How long a line stays on screen after its last word — the cap applies to
 * EVERY line, not just the last one. The next line takes over the instant it
 * starts, so any pause shorter than this is bridged seamlessly; a silence
 * longer than this clears the caption until the next line starts, instead of
 * burning a stale line in over several seconds of nothing.
 */
export const CAPTION_LINE_MAX_HOLD_MS = 1500

/** Average advance per character, in em, for the faces that differ materially
 *  from the default. Keyed by the `SUPPORTED_FONT_NAMES` display names — the
 *  `satisfies` pins that a typo here can never become a silent miss. */
const CHAR_WIDTH_EM_BY_FACE: Record<string, number | undefined> = {
  // Condensed display faces — far narrower than a text sans.
  "Bebas Neue": 0.42,
  "Anton": 0.46,
  "Oswald": 0.48,
  // Geometric sans — wider than the humanist default.
  "Montserrat": 0.59,
  "Poppins": 0.59,
  "Raleway": 0.57,
  // Monospace — every glyph pays the widest advance.
  "Roboto Mono": 0.62,
  "Fira Code": 0.62,
} satisfies Partial<Record<SupportedFontName, number>>

/** Faces with no entry above (Inter, Roboto, Lato, the serifs, the RTL faces). */
const DEFAULT_CHAR_WIDTH_EM = 0.56

/** Caps have no descender-narrow lowercase, so a line of them is ~15 % wider. */
const UPPERCASE_WIDTH_FACTOR = 1.15

/** 800/900 cuts carry visibly more ink per glyph than the 400-700 range. */
const HEAVY_WEIGHT_WIDTH_FACTOR = 1.06
const HEAVY_WEIGHT_THRESHOLD = 800

export interface CaptionFaceMetrics {
  /** A display name from `SUPPORTED_FONT_NAMES`; unknown names take the default. */
  readonly fontFamily?: string
  readonly fontWeight?: number
  readonly uppercase?: boolean
}

/**
 * A deliberately CONSERVATIVE average advance per character (spaces included)
 * for a face/weight/casing combination, in em.
 *
 * Conservative on purpose: the estimate must be at least the real measurement,
 * because overshooting only packs one word fewer onto a line while undershooting
 * wraps to two lines — the bug this module exists to kill. The calibration
 * point is the default `outline` look (Montserrat 900 UPPERCASE), which a real
 * production render measured at ~0.67 em/char and this returns as ~0.72.
 */
export function captionCharWidthEm(metrics: CaptionFaceMetrics): number {
  const { fontFamily, fontWeight, uppercase } = metrics
  let em = (fontFamily ? CHAR_WIDTH_EM_BY_FACE[fontFamily] : undefined) ?? DEFAULT_CHAR_WIDTH_EM
  if (uppercase) em *= UPPERCASE_WIDTH_FACTOR
  if (fontWeight !== undefined && fontWeight >= HEAVY_WEIGHT_THRESHOLD) em *= HEAVY_WEIGHT_WIDTH_FACTOR
  return em
}

export interface CaptionLineBudgetInput extends CaptionFaceMetrics {
  /** Composition width in px (from `useVideoConfig`). */
  readonly frameWidth: number
  readonly fontSize: number
}

/** How many characters fit on one line at this frame width, size and face.
 *  Floored at 6 so a pathological size still groups something readable. */
export function captionLineCharBudget(input: CaptionLineBudgetInput): number {
  const { frameWidth, fontSize } = input
  return Math.max(6, Math.floor((frameWidth * CAPTION_LINE_WIDTH_FRACTION) / (fontSize * captionCharWidthEm(input))))
}

/** A word that ends a sentence, allowing one trailing quote/bracket
 *  (`end."`, `end.)`, `end.]`). A comma does NOT close a line. */
const SENTENCE_END = /[.!?…]["')\]]?$/

/**
 * Greedy, in-order grouping of word captions into lines. A new line starts
 * before a word when the current line is non-empty AND any of:
 *   - the previous word ended a sentence,
 *   - the pause before this word is at least `CAPTION_LINE_BREAK_GAP_MS`,
 *   - adding the word (plus its separating space) would exceed `maxChars`.
 *
 * A word longer than `maxChars` therefore gets a line to itself — the first
 * clause never fires on an empty line, and the next word breaks again. Captions
 * whose trimmed text is empty are skipped entirely (they would render as a
 * phantom word and, worse, as a phantom line break).
 *
 * After the greedy pass, lines split ONLY for width are rebalanced so a phrase
 * never leaves a one-word widow behind (see `rebalanceBudgetBreaks`).
 */
export function groupCaptionLines(captions: readonly Caption[], maxChars: number): CaptionLine[] {
  // `budgetBreak[i]` = line i was closed ONLY because the next word did not fit
  // (not by a sentence end or a pause) — i.e. line i and i+1 are one phrase that
  // was split for width, which is the only kind of break widow control may move.
  const groups: Caption[][] = []
  const budgetBreak: boolean[] = []
  let words: Caption[] = []
  let length = 0
  let previous: { caption: Caption; text: string } | null = null

  const flush = (byBudget: boolean): void => {
    if (words.length === 0) return
    groups.push(words)
    budgetBreak.push(byBudget)
    words = []
    length = 0
  }

  // Group in TIME order, not array order. Nothing upstream guarantees a caller's
  // `captions[]` is start-sorted (the route validates no ordering), and both the
  // grouping and `activeCaptionLine`'s reverse scans assume monotonic starts — an
  // unsorted list produced inverted lines that vanished mid-word. Sort a COPY
  // (stable, so equal starts keep their given order); never mutate the input.
  const ordered = [...captions].sort((a, b) => a.startMs - b.startMs)

  for (const caption of ordered) {
    const text = caption.text.trim()
    if (text.length === 0) continue
    if (words.length > 0 && previous !== null) {
      const phraseEnds =
        SENTENCE_END.test(previous.text) ||
        caption.startMs - previous.caption.endMs >= CAPTION_LINE_BREAK_GAP_MS
      if (phraseEnds) flush(false)
      else if (length + 1 + text.length > maxChars) flush(true)
    }
    // A line's length is the sum of its words plus one space between them.
    length = words.length === 0 ? text.length : length + 1 + text.length
    words.push(caption)
    previous = { caption, text }
  }
  flush(false)

  rebalanceBudgetBreaks(groups, budgetBreak, maxChars)
  return groups.map((g) => ({ words: g, startMs: g[0]!.startMs, endMs: lineEndMs(g) }))
}

/**
 * When a line stops being spoken: the LATEST end among its words — never simply
 * the last word's `endMs`. One bad value there (a caller's `endMs: 0`, or
 * insanely-fast-whisper's `timestamp: [start, null]` on a final chunk cut
 * mid-word, which maps to 0) would otherwise put the whole line's hold window in
 * the past and blank every word in it. A word's end is also floored at its own
 * start, so an inverted window cannot shorten the line.
 */
const lineEndMs = (words: readonly Caption[]): number =>
  words.reduce((end, w) => Math.max(end, w.startMs, w.endMs), 0)

const lineLength = (words: readonly Caption[]): number =>
  words.reduce((sum, w, i) => sum + w.text.trim().length + (i === 0 ? 0 : 1), 0)

/**
 * Widow control. Greedy filling strands the tail of a phrase on its own line
 * ("OK SO I BUILT A WORLD IN NODARO" / "STUDIO."), which reads as a stutter.
 * For each pair of lines split ONLY for width, move trailing words of the upper
 * line down while the lower line still fits AND the pair gets more balanced.
 * Walks bottom-up so a three-line phrase settles in one pass. Never crosses a
 * sentence end or a pause — those breaks are the speaker's, not the layout's.
 */
function rebalanceBudgetBreaks(groups: Caption[][], budgetBreak: readonly boolean[], maxChars: number): void {
  for (let i = groups.length - 2; i >= 0; i--) {
    if (!budgetBreak[i]) continue
    const upper = groups[i]!
    const lower = groups[i + 1]!
    while (upper.length > 1) {
      const moved = upper[upper.length - 1]!
      const before = Math.abs(lineLength(upper) - lineLength(lower))
      const nextUpper = upper.slice(0, -1)
      const nextLower = [moved, ...lower]
      if (lineLength(nextLower) > maxChars) break
      if (Math.abs(lineLength(nextUpper) - lineLength(nextLower)) >= before) break
      upper.pop()
      lower.unshift(moved)
    }
  }
}

/** The line on screen at `ms`, and which of its words is highlighted. */
export interface ActiveCaptionLine {
  readonly line: CaptionLine
  /** Index WITHIN `line.words` of the last word whose startMs has passed.
   *  Never -1 while the line is visible, so a gap keeps the last-spoken word
   *  lit instead of dropping the highlight. */
  readonly activeIndex: number
}

/**
 * The LAST line that has started by `ms` — so the next line takes over the
 * instant its first word starts, and until then the current line is held
 * through both intra-line and inter-line pauses. Returns null before the first
 * line starts, and null once `ms` is past `endMs + CAPTION_LINE_MAX_HOLD_MS`
 * (a silence too long to hold through, wherever it falls). `lines` is assumed
 * to be in caption order, which is what `groupCaptionLines` produces.
 */
export function activeCaptionLine(lines: readonly CaptionLine[], ms: number): ActiveCaptionLine | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (line.startMs > ms) continue
    if (ms > line.endMs + CAPTION_LINE_MAX_HOLD_MS) return null
    let activeIndex = 0
    for (let w = line.words.length - 1; w >= 0; w--) {
      if (line.words[w]!.startMs <= ms) {
        activeIndex = w
        break
      }
    }
    return { line, activeIndex }
  }
  return null
}
