/**
 * Atom fixtures, each shaped after a feed that was read off the wire on
 * 2026-09-20 (synthetic text, real structure). What matters is the STRUCTURE
 * each one pins, because that is what the parser got wrong or could get wrong:
 *
 *  - YOUTUBE_CHANNEL_ATOM — `yt:` / `media:` namespaces, `<link rel="alternate">`,
 *    `<published>` beside `<updated>`, and the description nested in
 *    `<media:group><media:description>`. Carries the look-alikes on purpose:
 *    `<media:title>` beside `<title>`, `<yt:videoId>` beside `<id>`, and a
 *    self-closing `<media:content …/>` that is NOT Atom's `<content>`.
 *  - BLOG_ATOM — the jpmonette/feed generator (figma.com/blog): CDATA inside
 *    `<title type="html">`, a bare `<link href/>` with no `rel`, `<updated>`
 *    only, `<content type="html">` in CDATA.
 *  - RELEASES_ATOM — github.com/<repo>/releases.atom: attributes in the order
 *    `type`, `rel`, `href`, and entity-escaped HTML in `<content>`.
 */

export const YOUTUBE_CHANNEL_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCexample0000000000000000"/>
 <id>yt:channel:example0000000000000000</id>
 <yt:channelId>example0000000000000000</yt:channelId>
 <title>Example Channel</title>
 <link rel="alternate" href="https://www.youtube.com/channel/UCexample0000000000000000"/>
 <author>
  <name>Example Channel</name>
  <uri>https://www.youtube.com/channel/UCexample0000000000000000</uri>
 </author>
 <published>2015-03-02T10:00:00+00:00</published>
 <entry>
  <id>yt:video:AAAAAAAAAAA</id>
  <yt:videoId>AAAAAAAAAAA</yt:videoId>
  <yt:channelId>UCexample0000000000000000</yt:channelId>
  <title>First video &amp; friends</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
  <author>
   <name>Example Channel</name>
   <uri>https://www.youtube.com/channel/UCexample0000000000000000</uri>
  </author>
  <published>2026-09-18T15:00:12+00:00</published>
  <updated>2026-09-19T08:30:00+00:00</updated>
  <media:group>
   <media:title>First video (media title)</media:title>
   <media:content url="https://www.youtube.com/v/AAAAAAAAAAA?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg" width="480" height="360"/>
   <media:description>What the first video is about.
Second line of the description.</media:description>
   <media:community>
    <media:starRating count="120" average="5.00" min="1" max="5"/>
    <media:statistics views="4200"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:BBBBBBBBBBB</id>
  <yt:videoId>BBBBBBBBBBB</yt:videoId>
  <yt:channelId>UCexample0000000000000000</yt:channelId>
  <title>Second video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=BBBBBBBBBBB"/>
  <published>2026-09-10T09:00:00+00:00</published>
  <updated>2026-09-10T09:05:00+00:00</updated>
  <media:group>
   <media:title>Second video</media:title>
   <media:content url="https://www.youtube.com/v/BBBBBBBBBBB?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:description>About the second video.</media:description>
  </media:group>
 </entry>
</feed>`

export const BLOG_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <id>https://blog.example.com/</id>
    <title>Example Blog | Shortcut</title>
    <updated>2026-09-17T19:49:21.639Z</updated>
    <generator>https://github.com/jpmonette/feed</generator>
    <link rel="alternate" href="https://blog.example.com/"/>
    <link rel="self" href="https://blog.example.com/feed/atom.xml"/>
    <subtitle>Stories about people and plans.</subtitle>
    <entry>
        <title type="html"><![CDATA[Try these 5 tools—and share your own]]></title>
        <id>https://blog.example.com/try-these-5-tools/</id>
        <link href="https://blog.example.com/try-these-5-tools/"/>
        <updated>2026-09-16T12:00:00.000Z</updated>
        <content type="html"><![CDATA[Publishing is now live. <b>Here</b> are a few tools that stand out.]]></content>
    </entry>
    <entry>
        <title type="html"><![CDATA[Source material: an artist likes to break things]]></title>
        <id>https://blog.example.com/source-material/</id>
        <link href="https://blog.example.com/source-material/"/>
        <updated>2026-09-15T20:52:00.000Z</updated>
        <content type="html"><![CDATA[The throughline between drawing and computation.]]></content>
    </entry>
</feed>`

export const RELEASES_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/example/project/releases</id>
  <link type="text/html" rel="alternate" href="https://github.com/example/project/releases"/>
  <link type="application/atom+xml" rel="self" href="https://github.com/example/project/releases.atom"/>
  <title>Release notes from project</title>
  <updated>2026-09-16T18:08:50Z</updated>
  <entry>
    <id>tag:github.com,2008:Repository/1/v2.0.0</id>
    <updated>2026-09-16T18:16:39Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/example/project/releases/tag/v2.0.0"/>
    <title>v2.0.0</title>
    <content type="html">&lt;h3&gt;Notable Changes&lt;/h3&gt;
&lt;ul&gt;&lt;li&gt;&lt;a href=&quot;https://github.com/example/project/pull/7&quot;&gt;#7&lt;/a&gt; faster &amp;amp; smaller&lt;/li&gt;&lt;/ul&gt;</content>
    <author>
      <name>maintainer</name>
    </author>
    <media:thumbnail height="30" width="30" url="https://avatars.example.com/u/1?s=60&amp;v=4"/>
  </entry>
</feed>`

/** What youtube.com answered for EVERY channel feed during the 2026-09-20
 *  incident: an HTML error page (with a 404 or a 500 status). */
export const HTML_ERROR_PAGE = `<!DOCTYPE html>
<html lang=en>
  <meta charset=utf-8>
  <title>Error 404 (Not Found)!!1</title>
  <p><b>404.</b> <ins>That's an error.</ins>
  <p>The requested URL <code>/feeds/videos.xml</code> was not found on this server.
</html>`
