import { describe, it, expect, vi } from "vitest"
import { parseRssXml, fetchRssItems } from "../parser.js"

const BASIC_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <description>Hello world</description>
      <pubDate>Wed, 02 Oct 2002 13:00:00 GMT</pubDate>
      <guid>https://example.com/first</guid>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/second</link>
      <description>Another one</description>
      <pubDate>Thu, 03 Oct 2002 14:00:00 GMT</pubDate>
      <guid isPermaLink="false">post-2</guid>
    </item>
  </channel>
</rss>`

describe("parseRssXml", () => {
  it("extracts the five standard fields from a well-formed RSS 2.0 feed", () => {
    const items = parseRssXml(BASIC_RSS)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      title: "First post",
      url: "https://example.com/first",
      description: "Hello world",
      pubDate: "2002-10-02T13:00:00.000Z",
      guid: "https://example.com/first",
    })
    expect(items[1].guid).toBe("post-2")
  })

  it("respects the resultsLimit cap", () => {
    const items = parseRssXml(BASIC_RSS, 1)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("First post")
  })

  it("clamps resultsLimit to the hard 50-item cap", () => {
    // Stitch 60 identical items — parser should stop at 50.
    const item = `<item><title>t</title><link>https://e.com/x</link></item>`
    const xml = `<rss><channel>${item.repeat(60)}</channel></rss>`
    const items = parseRssXml(xml, 999)
    expect(items).toHaveLength(50)
  })

  it("defaults to 10 items when limit is omitted", () => {
    const item = `<item><title>t</title><link>https://e.com/x</link></item>`
    const xml = `<rss><channel>${item.repeat(20)}</channel></rss>`
    expect(parseRssXml(xml)).toHaveLength(10)
  })

  it("unwraps CDATA in title and description", () => {
    const xml = `<rss><channel>
      <item>
        <title><![CDATA[Breaking: <b>news</b>]]></title>
        <link>https://example.com/a</link>
        <description><![CDATA[<p>Rich HTML content</p>]]></description>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].title).toBe("Breaking: <b>news</b>")
    expect(items[0].description).toBe("<p>Rich HTML content</p>")
  })

  it("decodes named XML entities", () => {
    const xml = `<rss><channel>
      <item>
        <title>Jack &amp; Jill &lt;3</title>
        <link>https://example.com/a?x=1&amp;y=2</link>
        <description>&quot;quoted&quot; &apos;text&apos;</description>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].title).toBe("Jack & Jill <3")
    expect(items[0].url).toBe("https://example.com/a?x=1&y=2")
    expect(items[0].description).toBe('"quoted" \'text\'')
  })

  it("decodes numeric and hex entities", () => {
    const xml = `<rss><channel>
      <item>
        <title>caf&#233; &#x1F600;</title>
        <link>https://e.com/a</link>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].title).toBe("café 😀")
  })

  it("normalises RFC 822 pubDate to ISO 8601", () => {
    const xml = `<rss><channel>
      <item>
        <title>t</title>
        <link>https://e.com/a</link>
        <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].pubDate).toBe("2024-01-01T00:00:00.000Z")
  })

  it("passes pubDate through verbatim when it's not parseable", () => {
    // e.g. malformed feeds that put arbitrary text in pubDate
    const xml = `<rss><channel>
      <item>
        <title>t</title>
        <link>https://e.com/a</link>
        <pubDate>not-a-date</pubDate>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].pubDate).toBe("not-a-date")
  })

  it("falls back to the item URL when <guid> is absent", () => {
    const xml = `<rss><channel>
      <item>
        <title>t</title>
        <link>https://e.com/a</link>
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].guid).toBe("https://e.com/a")
  })

  it("reads the <entry> blocks of an Atom feed", () => {
    // This document used to parse to [] — and a completed run with [] is a
    // charged run (incident 2026-09-20). The Atom mapping itself is pinned in
    // parser-atom.test.ts.
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom entry</title>
    <link href="https://example.com/a"/>
  </entry>
</feed>`
    expect(parseRssXml(atom)).toEqual([
      { title: "Atom entry", url: "https://example.com/a", description: "", pubDate: "", guid: "https://example.com/a" },
    ])
  })

  it("handles Atom-style <link href> inside an <item>", () => {
    // Some RSS feeds embed <link href="..."/> in items even though the spec
    // says <link>URL</link>. Accept it as a fallback.
    const xml = `<rss><channel>
      <item>
        <title>t</title>
        <link href="https://e.com/atom-style" />
      </item>
    </channel></rss>`
    const items = parseRssXml(xml)
    expect(items[0].url).toBe("https://e.com/atom-style")
  })

  it("leaves an RSS item's <atom:link rel=\"self\"> alone — it is not the item's link", () => {
    // Un-prefixing is for documents whose ROOT is a prefixed Atom feed. Doing
    // it to an RSS feed would plant a second <link> inside its items.
    const xml = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
      <atom:link href="https://e.com/feed.xml" rel="self" type="application/rss+xml"/>
      <item>
        <title>t</title>
        <atom:link href="https://e.com/feed.xml" rel="self"/>
      </item>
    </channel></rss>`
    expect(parseRssXml(xml)[0].url).toBe("")
  })

  it("an RSS description that QUOTES </item> in CDATA does not end the item", () => {
    const xml = `<rss version="2.0"><channel>
      <item>
        <title>About feeds</title>
        <description><![CDATA[An item ends with </item>, like this.]]></description>
        <link>https://e.com/about</link>
      </item>
    </channel></rss>`
    expect(parseRssXml(xml)).toEqual([
      {
        title: "About feeds",
        url: "https://e.com/about",
        description: "An item ends with </item>, like this.",
        pubDate: "",
        guid: "https://e.com/about",
      },
    ])
  })

  it("yields empty strings for missing fields rather than throwing", () => {
    const xml = `<rss><channel><item></item></channel></rss>`
    const items = parseRssXml(xml)
    expect(items).toEqual([{
      title: "",
      url: "",
      description: "",
      pubDate: "",
      guid: "",
    }])
  })

  it("does not crash on malformed XML inside a feed", () => {
    // A document that is not a feed AT ALL now throws instead of returning []
    // (so it is refunded, not billed) — see parser-document.test.ts.
    expect(parseRssXml("<rss><channel><item><title>unterminated")).toEqual([])
    expect(parseRssXml("<rss version=\"2.0\"><<>broken")).toEqual([])
  })
})

describe("fetchRssItems", () => {
  function makeFetchResponse(body: string, contentLength?: number): Response {
    const bytes = new TextEncoder().encode(body)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
    const headers = new Headers({
      "content-type": "application/rss+xml",
      ...(contentLength !== undefined ? { "content-length": String(contentLength) } : {}),
    })
    return new Response(stream, { status: 200, headers })
  }

  it("fetches + parses using an injected fetch impl", async () => {
    const fakeFetch = async () => makeFetchResponse(BASIC_RSS)
    const items = await fetchRssItems({
      url: "https://example.com/feed.xml",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe("First post")
  })

  it("sends a browser-ish User-Agent + RSS Accept headers", async () => {
    let capturedInit: RequestInit | undefined
    const fakeFetch = async (_input: unknown, init?: RequestInit) => {
      capturedInit = init
      return makeFetchResponse(BASIC_RSS)
    }
    await fetchRssItems({
      url: "https://example.com/feed.xml",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })
    const headers = capturedInit?.headers as Record<string, string> | undefined
    expect(headers?.["User-Agent"]).toMatch(/Nodaro-RSS/)
    expect(headers?.Accept).toMatch(/rss/)
  })

  it("throws on non-2xx response with the status code in the message", async () => {
    // 403 is a verdict, not a blip: it fails at once. The statuses that ARE
    // retried (and the one retry a 404 earns) live in fetch-rss-retry.test.ts.
    const fakeFetch = vi.fn(async () => new Response("", { status: 403 }))
    await expect(
      fetchRssItems({
        url: "https://example.com/feed.xml",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 403/)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it("fails a response that is not a feed, without retrying it", async () => {
    const fakeFetch = vi.fn(async () => new Response("<!DOCTYPE html><html><body>Not found</body></html>", { status: 200 }))
    await expect(
      fetchRssItems({
        url: "https://example.com/feed.xml",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not an RSS or Atom feed/i)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it("returns [] for a valid feed that has no items", async () => {
    const fakeFetch = async () => makeFetchResponse(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>`)
    await expect(
      fetchRssItems({ url: "https://example.com/feed.atom", fetchImpl: fakeFetch as unknown as typeof fetch }),
    ).resolves.toEqual([])
  })

  it("rejects non-http(s) protocols before the fetch fires", async () => {
    const fakeFetch = async () => makeFetchResponse(BASIC_RSS)
    await expect(
      fetchRssItems({
        url: "file:///etc/passwd",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/protocol/i)
  })

  it("throws when Content-Length exceeds maxBytes (cheap short-circuit)", async () => {
    const fakeFetch = async () => makeFetchResponse(BASIC_RSS, 10_000_000)
    await expect(
      fetchRssItems({
        url: "https://example.com/feed.xml",
        maxBytes: 1_000_000,
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/too large/i)
  })

  it("decodes feeds that declare ISO-8859-1 in the XML prolog", async () => {
    // Latin-1 bytes for "café" — 0xe9 is é. Decoded as utf-8 it becomes "", which
    // would leak into downstream text consumers as mojibake.
    const prologAndBefore = new TextEncoder().encode(
      `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
      `<rss version="2.0"><channel><item><title>`,
    )
    const titleBytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]) // "café" in Latin-1
    const afterTitle = new TextEncoder().encode(
      `</title><link>https://e.com/a</link></item></channel></rss>`,
    )
    const body = new Uint8Array(prologAndBefore.length + titleBytes.length + afterTitle.length)
    body.set(prologAndBefore, 0)
    body.set(titleBytes, prologAndBefore.length)
    body.set(afterTitle, prologAndBefore.length + titleBytes.length)

    const fakeFetch = async () => new Response(body, { status: 200 })
    const items = await fetchRssItems({
      url: "https://example.com/feed.xml",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })
    expect(items[0].title).toBe("café")
  })

  it("strips a UTF-8 BOM before parsing", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const body = new TextEncoder().encode(BASIC_RSS)
    const combined = new Uint8Array(bom.length + body.length)
    combined.set(bom, 0)
    combined.set(body, bom.length)
    const fakeFetch = async () => new Response(combined, { status: 200 })
    const items = await fetchRssItems({
      url: "https://example.com/feed.xml",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe("First post")
  })

  it("falls back to utf-8 when the prolog declares an unknown encoding", async () => {
    // Typo'd encoding label ("utff-8") — TextDecoder would RangeError; ensure
    // we swallow that and still decode the body so the feed isn't lost to a
    // typo upstream.
    const xml = `<?xml version="1.0" encoding="utff-8"?>\n${BASIC_RSS.replace(/^<\?xml[^>]*\?>\s*/, "")}`
    const fakeFetch = async () => new Response(new TextEncoder().encode(xml), { status: 200 })
    const items = await fetchRssItems({
      url: "https://example.com/feed.xml",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe("First post")
  })

  it("aborts the body read when the timeout fires mid-stream", async () => {
    // Simulates a slowloris feed: headers land instantly (Response resolves)
    // but the body stalls after one chunk. If the timeout only covered
    // fetch+headers, readLimited would hang until Fastify's 10-min request
    // timeout. With the fix, the controller.abort() fires during streaming
    // and the stream errors out in under the test's 2s budget.
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(new TextEncoder().encode(`<?xml version="1.0"?><rss>`))
        // Intentionally never enqueue more, never close.
      },
    })
    const fakeFetch = async (_input: unknown, init?: RequestInit) => {
      // Real undici tears down the socket on abort; simulate by erroring the
      // stream so reader.read() throws.
      init?.signal?.addEventListener("abort", () => {
        streamController?.error(new Error("aborted"))
      })
      return new Response(stream, { status: 200 })
    }
    await expect(
      fetchRssItems({
        url: "https://example.com/feed.xml",
        timeoutMs: 50,
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow()
  }, 2000)
})
