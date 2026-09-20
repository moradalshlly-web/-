/**
 * One Atom `<entry>` → the five public item fields.
 *
 *   title       <title>
 *   url         the entry's page: <link rel="alternate" href> (a <link> with no
 *               rel IS an alternate — RFC 4287 §4.2.7.2), else the first link
 *               that is neither `self` nor `enclosure`
 *   description <summary>, else <content>, else <media:description>
 *               (YouTube nests it in <media:group>)
 *   pubDate     <published>, else <updated> — ISO 8601
 *   guid        <id>, else the url
 *
 * docs/nodes/input/web-scrape.md publishes this table; keep the two in step.
 */
import type { RssItem } from "./types.js"
import { TAG_ATTRIBUTES, blankElements, extractTagVia, maskCdata, normalisePubDate, parseAttributes } from "./xml-text.js"

const LINK_TAG = new RegExp(`<link(?=[\\s/>])${TAG_ATTRIBUTES}>`, "gi")

/** `rel` may be written as the registered name or as its IANA IRI. */
const IANA_REL_PREFIX = "http://www.iana.org/assignments/relation/"

/**
 * Links that are never the entry's page. `self` is the entry's own Atom
 * document and `enclosure` is a media file; handing either out as `url` would
 * send "open the source" to an XML document or an .mp3. An entry that has
 * nothing else gets an empty `url` — the same answer an RSS item gets when it
 * has an <enclosure> and no <link> — and still keeps its <id> as the guid.
 */
const NOT_THE_PAGE: ReadonlySet<string> = new Set(["self", "enclosure"])

function relOf(attributes: Readonly<Record<string, string>>): string {
  const rel = (attributes.rel ?? "").trim().toLowerCase()
  if (rel === "") return "alternate"
  return rel.startsWith(IANA_REL_PREFIX) ? rel.slice(IANA_REL_PREFIX.length) : rel
}

/** `view` has everything that is not the entry's own markup blanked out, and a
 *  `<link>` carries all it has to say in its attributes — nothing to read back
 *  from the original. */
function extractAtomLink(view: string): string {
  const links = Array.from(view.matchAll(LINK_TAG), (m) => parseAttributes(m[1]))
    .filter((attributes) => (attributes.href ?? "") !== "")
  const page = links.find((attributes) => relOf(attributes) === "alternate")
    ?? links.find((attributes) => !NOT_THE_PAGE.has(relOf(attributes)))
  return page?.href ?? ""
}

export function parseAtomEntry(block: string): RssItem {
  // An entry's free text can carry tags of its own — an <svg><title>, a
  // stylesheet <link>, an HTML5 <summary> — and Atom fixes no element order, so
  // the content may well come FIRST. Every field is therefore LOCATED in a view
  // of the entry with the free text blanked out, and READ from the entry itself:
  //   - CDATA is character data, never markup;
  //   - <source> is the feed an aggregated entry was copied from, with a
  //     title / id / link of its own;
  //   - <content> and <summary> may hold real child elements (type="xhtml").
  // The views are the same length as the entry, so the indices line up.
  const own = blankElements(maskCdata(block), ["source"])
  const withoutContent = blankElements(own, ["content"])
  const fields = blankElements(withoutContent, ["summary"])

  const url = extractAtomLink(fields)
  return {
    title: extractTagVia(block, fields, "title"),
    url,
    description:
      extractTagVia(block, withoutContent, "summary")
      || extractTagVia(block, own, "content")
      || extractTagVia(block, own, "media:description"),
    pubDate: normalisePubDate(extractTagVia(block, fields, "published") || extractTagVia(block, fields, "updated")),
    guid: extractTagVia(block, fields, "id") || url,
  }
}
