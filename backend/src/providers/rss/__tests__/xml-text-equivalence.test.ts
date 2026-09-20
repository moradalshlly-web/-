/**
 * "RSS 2.0 behaviour is unchanged" — held to an oracle.
 *
 * `extractTag` and the CDATA unwrapping in `decodeXmlText` were rewritten to be
 * linear in the input (see the top of xml-text.ts). The RSS `<item>` mapper is
 * built on both, so the rewrite must not change a single answer. The ORIGINAL
 * implementations are kept here, verbatim, as the oracle, and both are run over
 * a corpus of blocks shaped like the feeds this parser meets.
 *
 * Two input classes are left out on purpose, because there the answers differ
 * by design:
 *  - an opening tag with a raw `<` before its `>` (`<title <b>x</b></title>`).
 *    That is not XML — a `<` may not appear in a tag — and the old pattern's
 *    answer for it ("x</b>") was as much garbage as the new one's (""). Letting a
 *    tag run across `<` is exactly what made the old pattern quadratic.
 *  - a numeric character reference that names no code point (`&#1114112;`): the
 *    old code THREW a RangeError on it and took the whole feed down. Pinned on
 *    its own at the bottom of this file.
 */
import { describe, it, expect } from "vitest"
import { decodeXmlText, extractTag } from "../xml-text.js"

function legacyDecodeXmlText(raw: string): string {
  let s = raw
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) => inner)
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = parseInt(code, 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, hex) => {
      const n = parseInt(hex, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m
    })
  return s.trim()
}

function legacyExtractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i")
  const m = re.exec(block)
  return m ? legacyDecodeXmlText(m[1]) : ""
}

const TAGS = ["title", "link", "description", "pubDate", "guid", "content", "summary", "id", "media:description"]

const BLOCKS: readonly string[] = [
  // plain RSS 2.0
  `<title>First post</title><link>https://example.com/first</link><description>Hello world</description><pubDate>Wed, 02 Oct 2002 13:00:00 GMT</pubDate><guid>https://example.com/first</guid>`,
  // attributes, mixed case, whitespace and newlines inside tags
  `<TITLE>Upper</TITLE>\n<Link>https://e.com/a</Link>\n<guid isPermaLink="false">post-2</guid>\n<description\n  xml:lang="en">two\nlines</description>`,
  // CDATA: one, several, mixed with text, empty, containing markup and entities
  `<title><![CDATA[Breaking: <b>news</b>]]></title><description><![CDATA[<p>Rich &amp; HTML</p>]]></description>`,
  `<title>a <![CDATA[b]]> c <![CDATA[d]]> e</title><description><![CDATA[]]></description>`,
  `<description><![CDATA[text with ]] and ]> and > inside]]></description>`,
  // CDATA that never closes, and a closer with no opener
  `<title><![CDATA[never closed</title><description>x ]]> y</description>`,
  `<title><![CDATA[one]]><![CDATA[never closed</title>`,
  // entities: named, numeric, hex, malformed, double-escaped
  `<title>Jack &amp; Jill &lt;3 &quot;q&quot; &apos;a&apos;</title><description>caf&#233; &#x1F600; &#; &#x; &#12 &bogus; &amp;lt;b&amp;gt;</description>`,
  // missing, empty, self-closing, duplicated, nested look-alikes
  ``,
  `<title></title><link/><guid />`,
  `<title>first</title><title>second</title>`,
  `<media:title>media</media:title><title>real</title><media:description>m-desc</media:description>`,
  `<description-extra>no</description-extra><description>yes</description>`,
  `<titles>no</titles><title>yes</title>`,
  // a closing tag before any opening tag, an opening tag that never closes
  `</title><title>after</title>`,
  `<title>never closed <link>https://e.com/x</link>`,
  `<title>one</title><description>never closed`,
  // a > inside a quoted attribute value ends the tag for both spellings
  `<guid note="a>b">g</guid>`,
  // leading / trailing whitespace is trimmed
  `<title>\n   padded   \n</title>`,
  // Atom-ish blocks, for the tags the entry mapper shares
  `<id>urn:1</id><summary type="html">&lt;p&gt;s&lt;/p&gt;</summary><content type="html"><![CDATA[<p>c</p>]]></content>`,
  // unicode
  `<title>עברית — 日本語 — 😀</title>`,
]

describe("extractTag — same answers as the pattern it replaced", () => {
  it.each(TAGS)("<%s>", (tag) => {
    for (const block of BLOCKS) {
      expect({ block, value: extractTag(block, tag) }).toEqual({ block, value: legacyExtractTag(block, tag) })
    }
  })

  it("and the same for every block wrapped in surrounding markup", () => {
    for (const block of BLOCKS) {
      const wrapped = `<author><name>n</name></author>${block}<category>c</category>`
      for (const tag of TAGS) {
        expect(extractTag(wrapped, tag)).toBe(legacyExtractTag(wrapped, tag))
      }
    }
  })
})

describe("decodeXmlText — a character reference that names no code point", () => {
  it("is left as written instead of throwing (the old code failed the whole feed)", () => {
    expect(() => legacyDecodeXmlText("&#1114112;")).toThrow(RangeError)
    expect(decodeXmlText("ok &#1114112; &#xFFFFFFFF; &#x110000; &#99999999999999999999; ok")).toBe(
      "ok &#1114112; &#xFFFFFFFF; &#x110000; &#99999999999999999999; ok",
    )
    expect(decodeXmlText("&#x10FFFF;&#65;&#x41;")).toBe(`${String.fromCodePoint(0x10ffff)}AA`)
  })
})

describe("decodeXmlText — same answers as the pattern it replaced", () => {
  const TEXTS: readonly string[] = [
    ...BLOCKS,
    `<![CDATA[`,
    `]]>`,
    `<![CDATA[]]>`,
    `<![CDATA[a]]]]><![CDATA[>b]]>`,
    `<![CDATA[<![CDATA[nested]]>]]>`,
    `  <![CDATA[  keep inner spaces  ]]>  `,
    `&amp;amp; &amp;#38; &#38;amp;`,
  ]

  it.each(TEXTS.map((text, i) => [i, text] as const))("text #%i", (_i, text) => {
    expect(decodeXmlText(text)).toBe(legacyDecodeXmlText(text))
  })
})
