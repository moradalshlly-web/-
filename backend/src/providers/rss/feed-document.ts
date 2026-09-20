/**
 * Is this document a feed at all?
 *
 * "The feed has nothing in it" and "this is not a feed" used to be the same
 * answer — `[]` — and the route charges a completed `[]`. They are told apart
 * by the document's ROOT element, never by a tag that merely appears somewhere
 * in it: an HTML error page can print `<feed>` in a code sample.
 *
 * Linear in the body, like everything that reads it (see xml-text.ts): the root
 * is read ONCE per document, each leading construct is matched at a fixed
 * position with a sticky pattern, and no alternative in a pattern can start
 * where another one can.
 */
import { TAG_ATTRIBUTES, escapeRegExp, parseAttributes } from "./xml-text.js"

const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom"

/** Local names of the roots we read: `<rss>`, `<rdf:RDF>` (RSS 1.0), `<feed>`. */
const FEED_ROOTS: ReadonlySet<string> = new Set(["rss", "rdf", "feed"])

/**
 * What may legally stand before the root: the XML declaration and other
 * processing instructions (`<?xml-stylesheet …?>`), comments, and a DOCTYPE
 * (RSS 0.91 ships one, sometimes with an internal `[…]` subset).
 *
 * The DOCTYPE branch is written so that every character has exactly ONE way to
 * be consumed — plain, inside a quoted literal, or inside the `[…]` subset,
 * which ends at its first `]` outside a literal. A subset that may end at ANY
 * later `]` makes a run of `[a][a][a]…` with no closing `>` exponential: a body
 * of about a hundred bytes was enough to hold the event loop for hours.
 */
const BEFORE_THE_ROOT =
  /\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>"']|"[^"]*"|'[^']*'|\[(?:[^\]"']|"[^"]*"|'[^']*')*\])*>)/iy

const ROOT_TAG = new RegExp(`\\s*<([A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?)(?=[\\s/>])${TAG_ATTRIBUTES}>`, "y")

/** More leading constructs than any real feed carries; a document that has
 *  more is simply not recognised (and so not billed). Bounds the loop below
 *  against a body made of nothing but comments. */
const MAX_LEADING_CONSTRUCTS = 64

/** What the top of a document says it is. */
export interface DocumentRoot {
  /** The root element's name as written (`rss`, `rdf:RDF`, `a:feed`, `html`…),
   *  or `undefined` when the document does not start with an element at all. */
  readonly name: string | undefined
  /** RSS or Atom — i.e. "no items" means an empty feed, not the wrong document. */
  readonly isFeed: boolean
  /** Set when the root is `<p:feed xmlns:p="…Atom">`: the prefix every Atom
   *  element in this document carries. */
  readonly atomPrefix: string | undefined
}

const NO_ROOT: DocumentRoot = { name: undefined, isFeed: false, atomPrefix: undefined }

export function readDocumentRoot(xml: string): DocumentRoot {
  // Index-based on purpose: slicing a 5 MB body once per leading construct would
  // copy it up to MAX_LEADING_CONSTRUCTS times. A byte-order mark needs no step of
  // its own: JavaScript's \s matches U+FEFF, so each pattern's leading \s* eats it.
  let pos = 0
  for (let i = 0; i < MAX_LEADING_CONSTRUCTS; i++) {
    BEFORE_THE_ROOT.lastIndex = pos
    if (!BEFORE_THE_ROOT.exec(xml)) break
    pos = BEFORE_THE_ROOT.lastIndex
  }
  ROOT_TAG.lastIndex = pos
  const m = ROOT_TAG.exec(xml)
  if (!m) return NO_ROOT

  const name = m[1]
  const [first, local] = name.split(":")
  if (local === undefined) return { name, isFeed: FEED_ROOTS.has(first.toLowerCase()), atomPrefix: undefined }
  if (local.toLowerCase() !== "feed") return { name, isFeed: FEED_ROOTS.has(local.toLowerCase()), atomPrefix: undefined }
  // A prefixed <feed> counts only when the prefix is bound to the Atom namespace
  // on the root itself — some other vocabulary's `<x:feed>` is not ours to read.
  const bound = parseAttributes(m[2])[`xmlns:${first.toLowerCase()}`] === ATOM_NAMESPACE
  return { name, isFeed: bound, atomPrefix: bound ? first : undefined }
}

/**
 * An Atom document may bind the namespace to a prefix and write every element
 * with it (`<a:feed><a:entry><a:title>`). When the ROOT is written that way,
 * drop the prefix so the one set of patterns reads it. Only then: an RSS feed
 * routinely carries a stray `<atom:link rel="self">`, and un-prefixing that
 * would plant a second `<link>` inside its items.
 */
export function withoutAtomRootPrefix(xml: string, root: DocumentRoot): string {
  if (root.atomPrefix === undefined) return xml
  return xml.replace(new RegExp(`<(/?)${escapeRegExp(root.atomPrefix)}:`, "g"), "<$1")
}

/**
 * The error for a document that is not a feed. Names the root element we found
 * and NEVER echoes the body: this message is stored on the job and shown on the
 * node, and the body is whatever a stranger's server chose to send.
 */
export function notAFeedError(root: DocumentRoot, xml: string): Error {
  const found = root.name !== undefined
    ? `a <${root.name.slice(0, 40)}> document`
    : xml.trim() === "" ? "an empty response" : "a response that is not XML"
  return new Error(
    `Not an RSS or Atom feed: the address returned ${found}. Check that it points to the feed itself, not to a web page.`,
  )
}
