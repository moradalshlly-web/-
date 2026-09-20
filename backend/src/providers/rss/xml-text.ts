/**
 * String-level XML helpers shared by the RSS `<item>` and Atom `<entry>`
 * mappers. Regex + slicing, not an XML parser: a feed's shape is narrow enough
 * for that to be safe, and it keeps the backend free of a parser dependency.
 *
 * EVERYTHING HERE IS LINEAR IN THE INPUT, and has to stay so. The body is
 * whatever a stranger's server chose to send (up to 5 MB) and it is read on the
 * API process — one event loop for every route. The classic shape
 * `<open>[\s\S]*?</close>` is quadratic on a body of opening tags that never
 * close (each start scans to the end), and a lazy or quoted run inside a starred
 * group can be exponential. So: a tag's text never crosses a `<`, a search for a
 * closing tag is made ONCE per opening tag and given up for good when it fails,
 * and nothing restarts a scan it has already lost.
 * `__tests__/parser-adversarial.test.ts` holds every pattern to a wall-clock bound.
 */

const CDATA_OPEN = "<![CDATA["
const CDATA_CLOSE = "]]>"

/** `[start, end)` of every complete CDATA section, markers included. A section
 *  that never closes ends the search: nothing after it can close either. */
function cdataSections(text: string): ReadonlyArray<readonly [number, number]> {
  const sections: Array<readonly [number, number]> = []
  let pos = 0
  for (;;) {
    const start = text.indexOf(CDATA_OPEN, pos)
    if (start < 0) break
    const close = text.indexOf(CDATA_CLOSE, start + CDATA_OPEN.length)
    if (close < 0) break
    pos = close + CDATA_CLOSE.length
    sections.push([start, pos])
  }
  return sections
}

/** Lift the CDATA wrappers (may be mixed with plain text), keeping what is inside. */
function unwrapCdata(text: string): string {
  const sections = cdataSections(text)
  if (sections.length === 0) return text
  const parts: string[] = []
  let pos = 0
  for (const [start, end] of sections) {
    parts.push(text.slice(pos, start), text.slice(start + CDATA_OPEN.length, end - CDATA_CLOSE.length))
    pos = end
  }
  parts.push(text.slice(pos))
  return parts.join("")
}

/**
 * `text` with every CDATA section blanked out — SAME LENGTH, so an index found
 * in the result is an index into `text`.
 *
 * What is inside CDATA is character data, not markup: an `<svg><title>`, an
 * HTML5 `<summary>`, even the text `</entry>` in a post about feeds. Looking for
 * structure in this view, and reading the text out of the original, is what
 * keeps a post's content from being mistaken for the feed's own tags.
 */
export function maskCdata(text: string): string {
  const sections = cdataSections(text)
  if (sections.length === 0) return text
  const parts: string[] = []
  let pos = 0
  for (const [start, end] of sections) {
    parts.push(text.slice(pos, start), " ".repeat(end - start))
    pos = end
  }
  parts.push(text.slice(pos))
  return parts.join("")
}

/** A numeric character reference as text. One that names no code point
 *  (`&#1114112;`) is left as written: `String.fromCodePoint` THROWS on it, and
 *  one odd entity in one title used to fail the whole feed. */
function fromCodePoint(n: number, asWritten: string): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : asWritten
}

/** Lift CDATA wrappers and decode the handful of XML entities we care about. */
export function decodeXmlText(raw: string): string {
  // Named entities — numeric entities too for completeness.
  return unwrapCdata(raw)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, code) => fromCodePoint(parseInt(code, 10), m))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, hex) => fromCodePoint(parseInt(hex, 16), m))
    .trim()
}

export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface ElementSpan {
  /** The element, opening tag to closing tag: `[start, end)`. */
  readonly start: number
  readonly end: number
  /** What is between the two tags: `[innerStart, innerEnd)`. */
  readonly innerStart: number
  readonly innerEnd: number
}

/**
 * The first `<tag …>…</tag>` at or after `from`: the first opening tag, and the
 * first closing tag after it.
 *
 * One search each, never a retry. When the first opening tag has no closing tag
 * after it, no LATER opening tag has one either, so the answer is "none" — the
 * same answer `<tag>[\s\S]*?</tag>` reaches, without re-scanning the rest of the
 * text from every opening tag on the way.
 *
 * The name must follow `<` directly and be followed by whitespace or `>`, so a
 * namespaced LOOK-ALIKE never matches the bare name (`<media:title>` is not
 * `<title>`) and neither does a longer one (`<description-extra>`). `tag` itself
 * may be namespaced (`media:description`): a colon is an ordinary character in a
 * RegExp, and the name is escaped so nothing else in it ever reads as a pattern.
 *
 * `skipSelfClosing`: a `<tag …/>` has no body and must not be paired with a
 * closing tag further on. The RSS mapper never asked for that and keeps its
 * exact behaviour; the Atom mapper does (`<content src="…"/>` is legal Atom).
 */
function findElement(view: string, tag: string, from: number, skipSelfClosing: boolean): ElementSpan | undefined {
  const name = escapeRegExp(tag)
  const open = new RegExp(`<${name}(?:\\s[^<>]*)?>`, "gi")
  const close = new RegExp(`</${name}>`, "gi")
  open.lastIndex = from
  for (;;) {
    const opening = open.exec(view)
    if (!opening) return undefined
    if (skipSelfClosing && opening[0].endsWith("/>")) continue
    close.lastIndex = open.lastIndex
    const closing = close.exec(view)
    if (!closing) return undefined
    return { start: opening.index, end: close.lastIndex, innerStart: open.lastIndex, innerEnd: closing.index }
  }
}

/** The decoded text of the first `<tag>…</tag>` in `block`, or "". */
export function extractTag(block: string, tag: string): string {
  const span = findElement(block, tag, 0, false)
  return span ? decodeXmlText(block.slice(span.innerStart, span.innerEnd)) : ""
}

/**
 * Like `extractTag`, but the element is LOCATED in `view` and its text is READ
 * from `original`. `view` is `original` with some spans blanked out (CDATA,
 * other elements) and is the same length, so the indices line up.
 */
export function extractTagVia(original: string, view: string, tag: string): string {
  const span = findElement(view, tag, 0, true)
  return span ? decodeXmlText(original.slice(span.innerStart, span.innerEnd)) : ""
}

/**
 * `view` with every `<tag>…</tag>` element of the given names blanked out —
 * same length, so indices keep lining up with the original.
 */
export function blankElements(view: string, tags: readonly string[]): string {
  return tags.reduce((text, tag) => {
    const parts: string[] = []
    let pos = 0
    for (;;) {
      const span = findElement(text, tag, pos, true)
      if (!span) break
      parts.push(text.slice(pos, span.start), " ".repeat(span.end - span.start))
      pos = span.end
    }
    if (pos === 0) return text
    parts.push(text.slice(pos))
    return parts.join("")
  }, view)
}

/**
 * An opening tag's attribute text: everything up to the closing `>`, where a
 * `>` inside a quoted value does not end the tag. Never crosses a `<` (XML
 * forbids a raw `<` in an attribute value) — that is what bounds each attempt
 * to its own tag instead of the rest of the document.
 */
export const TAG_ATTRIBUTES = `((?:[^<>"']|"[^"<]*"|'[^'<]*')*)`

/**
 * One `name="value"`. The lookbehind makes a name start only after whitespace,
 * a `/` or the start of the text — without it, a long run with no `=` is
 * re-scanned from every one of its characters.
 */
const ATTRIBUTE = /(?<![^\s/])([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * Attributes of one opening tag, names lower-cased, values decoded.
 *
 * Read as whole `name="value"` tokens, in order — never by searching for
 * `rel=` / `href=` in the raw text, which would also find them INSIDE another
 * attribute's value (`title="see rel='self'"`), and which breaks as soon as a
 * feed writes `href` before `rel`.
 */
export function parseAttributes(source: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from(source.matchAll(ATTRIBUTE), (m) => [m[1].toLowerCase(), decodeXmlText(m[2] ?? m[3] ?? "")]),
  )
}

/** Normalise an RFC 822 date (or anything `Date` accepts) to ISO 8601. Pass
 *  the original string through when parsing fails so downstream filters can
 *  still see the raw value rather than an empty cell. */
export function normalisePubDate(raw: string): string {
  if (!raw) return ""
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toISOString()
}
