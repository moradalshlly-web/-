/**
 * Atom support in the Web Scrape RSS actor.
 *
 * Incident 2026-09-20: `findItemBlocks` matched only RSS 2.0 `<item>` blocks, so
 * every Atom document (`<feed>` + `<entry>`) parsed to `[]` — and the route
 * treats `[]` as a completed run, so the user was charged for nothing
 * (figma.com/blog/feed/atom.xml: 747 entries in, `{"json": []}` out). YouTube
 * channel feeds and GitHub `releases.atom` are Atom too.
 *
 * The item shape is a public wire contract (docs, MCP, SDK): exactly
 * `{ title, url, description, pubDate, guid }`, for both formats.
 */
import { describe, it, expect } from "vitest"
import { parseRssXml } from "../parser.js"
import { BLOG_ATOM, RELEASES_ATOM, YOUTUBE_CHANNEL_ATOM } from "./fixtures/atom-feeds.js"

const ITEM_KEYS = ["description", "guid", "pubDate", "title", "url"]

function atomFeed(entries: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed title</title>
  <id>urn:feed</id>
  <link rel="self" href="https://example.com/feed.atom"/>
  <updated>2026-01-01T00:00:00Z</updated>
  ${entries}
</feed>`
}

describe("parseRssXml — a YouTube channel feed", () => {
  it("maps each <entry> onto the five public fields", () => {
    const items = parseRssXml(YOUTUBE_CHANNEL_ATOM)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      title: "First video & friends",
      url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
      description: "What the first video is about.\nSecond line of the description.",
      pubDate: "2026-09-18T15:00:12.000Z",
      guid: "yt:video:AAAAAAAAAAA",
    })
    expect(items[1]).toEqual({
      title: "Second video",
      url: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
      description: "About the second video.",
      pubDate: "2026-09-10T09:00:00.000Z",
      guid: "yt:video:BBBBBBBBBBB",
    })
  })

  it("reads the entry's own tags, never their namespaced look-alikes", () => {
    const [first] = parseRssXml(YOUTUBE_CHANNEL_ATOM)
    // <title>, not <media:title>
    expect(first.title).not.toContain("media title")
    // <id>, not <yt:videoId> / <yt:channelId>
    expect(first.guid).toBe("yt:video:AAAAAAAAAAA")
    // <media:content url=…/> is not Atom's <content>: the description has to
    // come from <media:description>, a namespaced tag with a colon in its name.
    expect(first.description).toContain("What the first video is about.")
  })

  it("prefers <published> over <updated>", () => {
    const [first] = parseRssXml(YOUTUBE_CHANNEL_ATOM)
    expect(first.pubDate).toBe("2026-09-18T15:00:12.000Z")
  })

  it("never takes the feed's own title / id / links for an item", () => {
    const items = parseRssXml(YOUTUBE_CHANNEL_ATOM)
    expect(items.map((i) => i.title)).not.toContain("Example Channel")
    expect(items.map((i) => i.url).join(" ")).not.toContain("feeds/videos.xml")
  })
})

describe("parseRssXml — a plain Atom blog", () => {
  it("handles CDATA in <title type=\"html\">, a bare <link href/>, <updated> and <content>", () => {
    const items = parseRssXml(BLOG_ATOM)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      title: "Try these 5 tools—and share your own",
      url: "https://blog.example.com/try-these-5-tools/",
      description: "Publishing is now live. <b>Here</b> are a few tools that stand out.",
      pubDate: "2026-09-16T12:00:00.000Z",
      guid: "https://blog.example.com/try-these-5-tools/",
    })
  })

  it("reads attributes in any order and decodes entity-escaped HTML content", () => {
    const items = parseRssXml(RELEASES_ATOM)
    expect(items).toEqual([
      {
        title: "v2.0.0",
        url: "https://github.com/example/project/releases/tag/v2.0.0",
        description:
          '<h3>Notable Changes</h3>\n<ul><li><a href="https://github.com/example/project/pull/7">#7</a> faster &amp; smaller</li></ul>',
        pubDate: "2026-09-16T18:16:39.000Z",
        guid: "tag:github.com,2008:Repository/1/v2.0.0",
      },
    ])
  })

  it("keeps the item shape exactly { title, url, description, pubDate, guid }", () => {
    for (const xml of [YOUTUBE_CHANNEL_ATOM, BLOG_ATOM, RELEASES_ATOM]) {
      for (const item of parseRssXml(xml)) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS)
      }
    }
  })
})

describe("parseRssXml — which <link> is the entry's page", () => {
  it("prefers rel=\"alternate\" over self and enclosure, wherever it sits", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel="self" href="https://example.com/api/entries/1.atom"/>
      <link rel="enclosure" type="audio/mpeg" href="https://cdn.example.com/1.mp3"/>
      <link href="https://example.com/posts/1" rel="alternate" type="text/html"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/posts/1")
  })

  it("treats a <link> with no rel as the alternate (Atom's default)", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel="self" href="https://example.com/api/entries/1.atom"/>
      <link href="https://example.com/posts/1"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/posts/1")
  })

  it("a link with no rel outranks an earlier link of another kind", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel="related" href="https://example.com/related"/>
      <link href="https://example.com/posts/1"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/posts/1")
  })

  it("falls back to the first link that is neither self nor enclosure", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel="self" href="https://example.com/api/entries/1.atom"/>
      <link rel="enclosure" href="https://cdn.example.com/1.mp3"/>
      <link rel="related" href="https://example.com/related"/>
      <link rel="via" href="https://example.com/via"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/related")
  })

  it("leaves url empty when the only links are self / enclosure", () => {
    const xml = atomFeed(`<entry>
      <id>urn:entry:1</id>
      <title>t</title>
      <link rel="self" href="https://example.com/api/entries/1.atom"/>
      <link rel="enclosure" href="https://cdn.example.com/1.mp3"/>
    </entry>`)
    const [item] = parseRssXml(xml)
    expect(item.url).toBe("")
    expect(item.guid).toBe("urn:entry:1")
  })

  it("decodes &amp; in an href and accepts single-quoted attributes", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel='alternate' type='text/html' href='https://example.com/p?a=1&amp;b=2' title='t'/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/p?a=1&b=2")
  })

  it("is not fooled by rel= or href= written inside another attribute's value", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link title="see rel='self' href='https://wrong.example/' > here" href="https://example.com/posts/1"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/posts/1")
  })

  it("reads the IANA long form of a rel value", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <link rel="http://www.iana.org/assignments/relation/self" href="https://example.com/api/1.atom"/>
      <link rel="http://www.iana.org/assignments/relation/alternate" href="https://example.com/posts/1"/>
    </entry>`)
    expect(parseRssXml(xml)[0].url).toBe("https://example.com/posts/1")
  })
})

describe("parseRssXml — Atom field fallbacks", () => {
  it("an entry with no link has an empty url and keeps its <id> as the guid", () => {
    const xml = atomFeed(`<entry><id>urn:uuid:1</id><title>No link</title><updated>2026-02-03T04:05:06Z</updated></entry>`)
    expect(parseRssXml(xml)).toEqual([
      { title: "No link", url: "", description: "", pubDate: "2026-02-03T04:05:06.000Z", guid: "urn:uuid:1" },
    ])
  })

  it("falls back to the url when <id> is absent", () => {
    const xml = atomFeed(`<entry><title>t</title><link href="https://example.com/a"/></entry>`)
    expect(parseRssXml(xml)[0].guid).toBe("https://example.com/a")
  })

  it("description: <summary>, else <content>, else <media:description>", () => {
    const xml = atomFeed(`
      <entry><title>a</title><summary>the summary</summary><content>the content</content></entry>
      <entry><title>b</title><summary></summary><content type="html">the content</content></entry>
      <entry><title>c</title><content src="https://example.com/c.html" type="text/html"/><media:group><media:description>the media description</media:description></media:group></entry>
    `)
    expect(parseRssXml(xml).map((i) => i.description)).toEqual([
      "the summary",
      "the content",
      "the media description",
    ])
  })

  it("never pairs a self-closing <content/> with a closing tag further on", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <content src="https://example.com/full.html" type="text/html"/>
      <summary type="html"><![CDATA[how to write a </content> tag]]></summary>
      <id>urn:after</id>
    </entry>`)
    expect(parseRssXml(xml)[0]).toMatchObject({ description: "how to write a </content> tag", guid: "urn:after" })
  })

  it("a self-closing <content src=…/> does not swallow what follows it", () => {
    // Nothing here is character data, so masking cannot cover for the rule: a
    // <content/> paired with the LATER </content> would blank the <id> between
    // them out of view and read "<id>…<content …>the real content" as the text.
    const xml = atomFeed(`<entry>
      <title>t</title>
      <content src="https://example.com/full.html" type="text/html"/>
      <id>urn:between</id>
      <content type="text">the real content</content>
    </entry>`)
    expect(parseRssXml(xml)[0]).toMatchObject({ description: "the real content", guid: "urn:between" })
  })

  it("falls back to <updated> when <published> is absent, and passes an unparseable date through", () => {
    const xml = atomFeed(`
      <entry><title>a</title><updated>2026-03-04T05:06:07+02:00</updated></entry>
      <entry><title>b</title><published>sometime last week</published></entry>
    `)
    expect(parseRssXml(xml).map((i) => i.pubDate)).toEqual(["2026-03-04T03:06:07.000Z", "sometime last week"])
  })

  it("yields empty strings for an empty entry rather than throwing", () => {
    expect(parseRssXml(atomFeed(`<entry></entry>`))).toEqual([
      { title: "", url: "", description: "", pubDate: "", guid: "" },
    ])
  })
})

describe("parseRssXml — free text inside an entry cannot hijack its fields", () => {
  it("ignores <title>/<id>/<link> written inside the entry's content, even when the content comes first", () => {
    const xml = atomFeed(`<entry>
      <content type="html"><![CDATA[<svg><title>an icon</title></svg> <link rel="stylesheet" href="https://evil.example/x.css"> <id>not-the-id</id>]]></content>
      <title>The real title</title>
      <id>urn:real</id>
      <link href="https://example.com/real"/>
    </entry>`)
    expect(parseRssXml(xml)[0]).toMatchObject({
      title: "The real title",
      guid: "urn:real",
      url: "https://example.com/real",
    })
  })

  it("does not read an HTML <summary> inside the content as Atom's <summary>", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <content type="html"><![CDATA[<details><summary>click to expand</summary>the body</details>]]></content>
    </entry>`)
    expect(parseRssXml(xml)[0].description).toBe("<details><summary>click to expand</summary>the body</details>")
  })

  it("a post that QUOTES </entry> in its text does not end the entry", () => {
    const xml = atomFeed(`<entry>
      <content type="html"><![CDATA[<p>An Atom entry ends with </entry> and an RSS one with </item>.</p>]]></content>
      <title>About feeds</title>
      <id>urn:about-feeds</id>
    </entry>
    <entry><title>The next one</title></entry>`)
    expect(parseRssXml(xml).map((i) => [i.title, i.guid])).toEqual([
      ["About feeds", "urn:about-feeds"],
      ["The next one", ""],
    ])
    expect(parseRssXml(xml)[0].description).toBe(
      "<p>An Atom entry ends with </entry> and an RSS one with </item>.</p>",
    )
  })

  it("a <summary> that quotes a whole <content> element keeps every word of it", () => {
    const xml = atomFeed(`<entry>
      <title>t</title>
      <summary type="html"><![CDATA[Atom writes <content>the body</content> like this.]]></summary>
      <content type="html">the real content</content>
    </entry>`)
    expect(parseRssXml(xml)[0].description).toBe("Atom writes <content>the body</content> like this.")
  })

  it("does not read an XHTML <summary> element inside the content as Atom's <summary>", () => {
    // Not CDATA this time: type="xhtml" content holds REAL child elements, so
    // masking character data does not hide them — taking <content> out of view
    // before looking for <summary> does.
    const xml = atomFeed(`<entry>
      <title>t</title>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><details><summary>click to expand</summary><p>the body</p></details></div></content>
    </entry>`)
    expect(parseRssXml(xml)[0].description).toBe(
      `<div xmlns="http://www.w3.org/1999/xhtml"><details><summary>click to expand</summary><p>the body</p></details></div>`,
    )
  })

  it("markup QUOTED in a CDATA title is not the entry's link or id", () => {
    // The title is not blanked out of the view the link and the id are located
    // in — only masking its character data keeps what it quotes from being read
    // as the entry's own tags.
    const xml = atomFeed(`<entry>
      <title type="html"><![CDATA[How to write <link href="https://wrong.example/"> and <id>not-the-id</id>]]></title>
      <link rel="alternate" href="https://example.com/real"/>
      <id>urn:real</id>
    </entry>`)
    expect(parseRssXml(xml)[0]).toEqual({
      title: `How to write <link href="https://wrong.example/"> and <id>not-the-id</id>`,
      url: "https://example.com/real",
      description: "",
      pubDate: "",
      guid: "urn:real",
    })
  })

  it("reads an xhtml <content> whole, child elements and all", () => {
    const xml = atomFeed(`<entry>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><title>not the title</title><p>body</p></div></content>
      <title>The title</title>
    </entry>`)
    expect(parseRssXml(xml)[0]).toMatchObject({
      title: "The title",
      description: `<div xmlns="http://www.w3.org/1999/xhtml"><title>not the title</title><p>body</p></div>`,
    })
  })

  it("ignores the <source> feed's own title / id / link (aggregated entries)", () => {
    const xml = atomFeed(`<entry>
      <source>
        <id>urn:other-feed</id>
        <title>Some other feed</title>
        <link rel="alternate" href="https://other.example/"/>
        <updated>2020-01-01T00:00:00Z</updated>
      </source>
      <id>urn:entry</id>
      <title>The entry</title>
      <link rel="alternate" href="https://example.com/entry"/>
      <updated>2026-05-06T07:08:09Z</updated>
    </entry>`)
    expect(parseRssXml(xml)[0]).toEqual({
      title: "The entry",
      url: "https://example.com/entry",
      description: "",
      pubDate: "2026-05-06T07:08:09.000Z",
      guid: "urn:entry",
    })
  })
})

describe("parseRssXml — limits apply to entries too", () => {
  const entry = `<entry><title>t</title><link href="https://e.com/x"/></entry>`

  it("respects the resultsLimit", () => {
    const items = parseRssXml(BLOG_ATOM, 1)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Try these 5 tools—and share your own")
  })

  it("clamps to the hard 50-item cap", () => {
    expect(parseRssXml(atomFeed(entry.repeat(60)), 999)).toHaveLength(50)
  })

  it("defaults to 10", () => {
    expect(parseRssXml(atomFeed(entry.repeat(20)))).toHaveLength(10)
  })
})

describe("parseRssXml — documents that are not the usual shape", () => {
  it("keeps <item> and <entry> blocks in document order", () => {
    const xml = `<rss><channel>
      <item><title>one</title></item>
      <entry><title>two</title></entry>
      <item><title>three</title></item>
    </channel></rss>`
    expect(parseRssXml(xml).map((i) => i.title)).toEqual(["one", "two", "three"])
  })

  it("an empty self-closing <entry/> is an empty item — it does not swallow the entry after it", () => {
    const xml = atomFeed(`<entry/><entry><title>real</title></entry>`)
    expect(parseRssXml(xml).map((i) => i.title)).toEqual(["", "real"])
  })

  it("reads an Atom document whose elements carry a namespace prefix", () => {
    const xml = `<?xml version="1.0"?>
<a:feed xmlns:a="http://www.w3.org/2005/Atom">
  <a:title>Prefixed</a:title>
  <a:entry>
    <a:id>urn:1</a:id>
    <a:title>Prefixed entry</a:title>
    <a:link rel="alternate" href="https://example.com/prefixed"/>
    <a:published>2026-07-08T09:10:11Z</a:published>
    <a:summary>short</a:summary>
  </a:entry>
</a:feed>`
    expect(parseRssXml(xml)).toEqual([
      {
        title: "Prefixed entry",
        url: "https://example.com/prefixed",
        description: "short",
        pubDate: "2026-07-08T09:10:11.000Z",
        guid: "urn:1",
      },
    ])
  })
})
