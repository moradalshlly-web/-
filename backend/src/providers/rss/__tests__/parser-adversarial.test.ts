/**
 * The body is a stranger's — and it is read on the API's one event loop.
 *
 * The RSS fetch runs IN the API process (there is no worker behind this route),
 * so a body that makes a pattern run for a minute stops every other route for a
 * minute. Any signed-in user can point the node at a host they control.
 *
 * Every shape below made an earlier spelling of one of these patterns
 * super-linear — measured before each was rewritten:
 *   - a DOCTYPE whose `[…]` subset could end at ANY later `]`: EXPONENTIAL. 85
 *     bytes took 120 ms, 133 bytes would have taken hours.
 *   - an attribute pattern that re-scanned a long run from every character, an
 *     opening tag allowed to run across `<`, `<open>[\s\S]*?</close>` on a body of
 *     opening tags that never close, a lazy CDATA scan: all QUADRATIC — 64 KB
 *     took a second or more, the 5 MB cap would have taken from minutes to hours.
 *
 * Real timers and a wall-clock bound on purpose: this is the one property that
 * cannot be asserted any other way. The bound is ~50x what the linear patterns
 * need on a slow machine, and the old ones miss it by orders of magnitude.
 */
import { describe, it, expect } from "vitest"
import { parseRssXml } from "../parser.js"

const BOUND_MS = 2_000
const MB = 1024 * 1024

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length))
}

/** Parse (a throw is a fine answer) and report how long it took. */
function timed(body: string): number {
  const started = performance.now()
  try {
    parseRssXml(body, 50)
  } catch {
    // "not a feed" is a legitimate verdict for most of these bodies
  }
  return performance.now() - started
}

const inEntry = (inner: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry>${inner}</entry></feed>`
const inItem = (inner: string) => `<rss version="2.0"><channel><item>${inner}</item></channel></rss>`

const BODIES: ReadonlyArray<readonly [string, string]> = [
  ["a DOCTYPE made of [a][a][a]… that never closes", `<!DOCTYPE x ${"[a]".repeat(60)}X`],
  ["the same, 4 MB of it", `<!DOCTYPE x ${fill("[a]", 4 * MB)}X`],
  ["a DOCTYPE subset full of quotes that never close", `<!DOCTYPE x [${fill(`"a" 'b' `, 2 * MB)}"`],
  ["5 MB of whitespace", fill(" \n", 5 * MB)],
  ["a million comments before the root", fill("<!-- c -->", 4 * MB)],
  ["a processing instruction that never ends", `<?xml ${fill("a", 4 * MB)}`],
  ["a root tag holding one 4 MB attribute-less token", `<feed ${fill("a", 4 * MB)}><entry><title>t</title></entry></feed>`],
  ["a root tag holding a million valueless names", `<feed ${fill("a= ", 4 * MB)}>`],
  ["a root tag with a quote that never closes", `<feed a="${fill("b", 4 * MB)}`],
  ["opening <entry tags that never reach a >", fill("<entry ", 4 * MB)],
  ["<entry> opened 600 000 times and never closed", fill("<entry>", 4 * MB)],
  ["<item> and <entry> opened alternately, never closed", fill("<item><entry>", 4 * MB)],
  ["one closing tag FIRST, then opening tags forever", `</entry>${fill("<entry>", 4 * MB)}`],
  ["<title> opened forever inside an entry", inEntry(fill("<title>", 4 * MB))],
  ["<title> opened forever inside an RSS item", inItem(fill("<title>", 4 * MB))],
  ["CDATA opened forever inside a title", inEntry(`<title>${fill("<![CDATA[", 4 * MB)}</title>`)],
  ["CDATA opened forever inside an RSS description", inItem(`<description>${fill("<![CDATA[", 4 * MB)}</description>`)],
  ["CDATA opened forever across the whole document", fill("<![CDATA[", 4 * MB)],
  ["<content opened forever inside an entry", inEntry(fill("<content ", 4 * MB))],
  ["<content> elements, thousands, all closed", inEntry(fill("<content>x</content>", 4 * MB))],
  ["<summary> and <source> opened forever", inEntry(fill("<summary><source>", 4 * MB))],
  ["<link opened forever inside an entry", inEntry(fill("<link ", 4 * MB))],
  ["<link opened forever inside an RSS item", inItem(fill("<link ", 4 * MB))],
  ["a <link> whose attribute text is one 4 MB token", inEntry(`<link ${fill("a", 4 * MB)}>`)],
  ["a <link> with quotes that pair up across the whole entry", inEntry(fill(`<link "`, 4 * MB))],
  ["half a million complete <link/> tags in one entry", inEntry(fill(`<link rel="self" href="https://e.com/x"/>`, 4 * MB))],
  ["entities that never end", inEntry(`<title>${fill("&#1", 4 * MB)}</title>`)],
]

describe("parseRssXml — no body can hold the event loop", () => {
  it.each(BODIES)("%s", (_name, body) => {
    expect(body.length).toBeLessThanOrEqual(5 * MB + 1024)
    expect(timed(body)).toBeLessThan(BOUND_MS)
  })

  it("stops collecting at the limit instead of walking a document of 600 000 entries", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom">${fill("<entry><title>t</title></entry>", 4 * MB)}</feed>`
    const started = performance.now()
    const items = parseRssXml(body, 50)
    expect(performance.now() - started).toBeLessThan(BOUND_MS)
    expect(items).toHaveLength(50)
  })
})
