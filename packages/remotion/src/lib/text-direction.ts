export type TextDirection = "rtl" | "ltr"

/** Hebrew + Hebrew presentation forms. */
const HEBREW_RANGES = "\\u0590-\\u05FF\\uFB1D-\\uFB4F"

/** Arabic (+ Supplement, Extended-A) and Arabic presentation forms A & B. */
const ARABIC_RANGES = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF"

/**
 * Strong right-to-left codepoints: Hebrew, Hebrew presentation forms, Arabic
 * (+ Supplement, Extended-A), and Arabic presentation forms A & B.
 */
const RTL_STRONG = new RegExp(`[${HEBREW_RANGES}${ARABIC_RANGES}]`)

/**
 * Base direction from the first *strong* directional character (Unicode bidi
 * rule P2/P3, simplified to the scripts we support). Neutrals — digits,
 * punctuation, whitespace, symbols — are skipped. Any non-RTL letter counts as
 * strong LTR. No strong char found → "ltr".
 */
export function detectBaseDirection(text: string): TextDirection {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return "rtl"
    if (/\p{L}/u.test(ch)) return "ltr"
  }
  return "ltr"
}

/** Explicit override wins; otherwise auto-detect from content. */
export function resolveDirection(text: string, explicit?: TextDirection): TextDirection {
  return explicit ?? detectBaseDirection(text)
}

/** Arabic-script codepoints (the Arabic subranges of RTL_STRONG; Hebrew excluded).
 *  letter-spacing on Arabic breaks cursive joining, so callers suppress tracking. */
const ARABIC = new RegExp(`[${ARABIC_RANGES}]`)

export const containsArabic = (text: string): boolean => ARABIC.test(text)

/**
 * Base direction for a row of caption words: the direction of the LANGUAGE of
 * the piece, so the row can be laid out RTL without reversing the words array
 * (which would corrupt timing indices). Decided by the MAJORITY of strong
 * letters across the whole list, not the first one: a Hebrew or Arabic piece
 * very often opens with a Latin token (a brand, a product, a handle), and
 * first-strong would lay every one of its lines out backwards. A tie — or a
 * list with no letters at all — falls back to the first strong character.
 */
export function rowDirectionFromCaptions(captions: readonly { text: string }[]): TextDirection {
  const text = captions.map((c) => c.text).join(" ")
  let rtl = 0
  let ltr = 0
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) rtl++
    else if (/\p{L}/u.test(ch)) ltr++
  }
  if (rtl > ltr) return "rtl"
  if (ltr > rtl) return "ltr"
  return detectBaseDirection(text)
}

/**
 * CSS props a text node spreads onto its style. `direction` comes straight from
 * `resolveDirection` (deterministic — no `unicode-bidi: plaintext`, which would
 * override the explicit `dir`). `textAlign` is only returned when the caller
 * opts in (surfaces that shrink-wrap don't need it).
 */
export function directionStyle(
  text: string,
  opts?: { explicit?: TextDirection; align?: boolean },
): { direction: TextDirection; textAlign?: "left" | "right" } {
  const direction = resolveDirection(text, opts?.explicit)
  if (opts?.align) {
    return { direction, textAlign: direction === "rtl" ? "right" : "left" }
  }
  return { direction }
}
