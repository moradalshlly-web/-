import { describe, it, expect, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Caption } from "@remotion/captions"

vi.mock("remotion", async () => ({
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
  spring: ({ frame }: { frame: number }) => Math.min(1, frame / 30),
  interpolate: (v: number, [a, b]: [number, number], [c, d]: [number, number]) => {
    if (v <= a) return c
    if (v >= b) return d
    return c + (v - a) / (b - a) * (d - c)
  },
  OffthreadVideo: ({ src }: { src: string }) => <video src={src} />,
}))

import { CaptionOverlay } from "../lib/caption-overlay"

const fixture: Caption[] = [
  { text: "Hello", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
  { text: " world", startMs: 500, endMs: 1000, timestampMs: 500, confidence: null },
]

describe("CaptionOverlay", () => {
  it.each(["subtitle", "word-highlight", "karaoke", "tiktok-words", "word-pop", "bouncy"] as const)(
    "renders style %s without throwing",
    (style) => {
      const html = renderToStaticMarkup(
        <CaptionOverlay
          captions={fixture}
          style={style}
          position="bottom"
          fontSize={32}
          color="#ffffff"
        />,
      )
      expect(html.length).toBeGreaterThan(0)
    },
  )
  // The @remotion/captions word delimiter is a LEADING SPACE on the word's
  // text. A per-word <span> rendered as inline-block starts its own line box,
  // and CSS removes a collapsible space at the start of a line — so every
  // inline-block word span must also carry white-space: pre, or the words
  // burn in glued together ("Twopeopletalking"). Pins the pair for every
  // style, so a new overlay that copies the inline-block span inherits the rule.
  it.each(["word-highlight", "karaoke", "bouncy"] as const)(
    "style %s keeps the leading-space delimiter on inline-block word spans",
    (style) => {
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={fixture} style={style} position="bottom" fontSize={32} color="#ffffff" />,
      )
      const spans = html.match(/<span[^>]*>[^<]*<\/span>/g) ?? []
      const wordSpans = spans.filter((s) => s.endsWith("> world</span>"))
      expect(wordSpans.length).toBeGreaterThan(0)
      for (const span of wordSpans) {
        if (span.includes("display:inline-block")) expect(span).toContain("white-space:pre")
      }
    },
  )

})
