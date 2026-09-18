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

  // word-highlight renders one grouped LINE at a time and HOLDS it through
  // pauses — a word's [startMs, endMs] drives the highlight, not whether text
  // is on screen. It used to key visibility off the active word alone (a
  // sliding +/-2 window), which rendered NOTHING in every inter-word gap.
  describe("word-highlight renders a held line, never a blank frame", () => {
    // The mocked frame 30 @ 30fps = 1000 ms, exactly the END of " world".
    it("renders the whole line, not a window, at the last word's end boundary", () => {
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={fixture} style="word-highlight" position="bottom" fontSize={32} color="#ffffff" />,
      )
      expect(html).toContain("Hello")
      expect(html).toContain(" world")
    })

    // The regression: at 1000 ms no word is being spoken (the first ended at
    // 400, the next starts at 1500). The old overlay returned null here.
    it("still renders the last line during a pause between words", () => {
      const gapped: Caption[] = [
        { text: "Hello", startMs: 0, endMs: 400, timestampMs: 0, confidence: null },
        { text: " world", startMs: 1500, endMs: 2000, timestampMs: 1500, confidence: null },
      ]
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={gapped} style="word-highlight" position="bottom" fontSize={32} color="#ffffff" />,
      )
      expect(html.length).toBeGreaterThan(0)
      // The HELD line is the one that already started — not the next one.
      expect(html).toContain("Hello")
      expect(html).not.toContain("world")
    })

    // Eight contiguous 125 ms words; at the mocked 1000 ms the LAST one is active.
    // The old overlay showed a sliding +/-2 window around it ("foxtrot golf
    // hotel"), so the first word could never be on screen.
    const eight: Caption[] = ["alpha", " bravo", " charlie", " delta", " echo", " foxtrot", " golf", " hotel"]
      .map((text, i) => ({ text, startMs: i * 125, endMs: (i + 1) * 125, timestampMs: i * 125, confidence: null }))

    it("shows the WHOLE grouped line, not a +/-2 window around the active word", () => {
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={eight} style="word-highlight" position="bottom" fontSize={32} color="#ffffff" />,
      )
      // 1920-wide frame @32px fits all eight words on one line.
      for (const word of ["alpha", " bravo", " hotel"]) expect(html).toContain(`>${word}</span>`)
    })

    // Production render 2026-09-18: a flat scale(1.15) drew the long active word
    // over its neighbour ("Nore-prompting."). At the mocked 1000 ms the active
    // word below is "re-prompting." — it must get the tapered, length-aware scale.
    it("tapers the active-word pop on a long word so it cannot cover its neighbour", () => {
      const clip: Caption[] = [
        { text: "No", startMs: 700, endMs: 900, timestampMs: 700, confidence: null },
        { text: " re-prompting.", startMs: 900, endMs: 1500, timestampMs: 900, confidence: null },
      ]
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={clip} style="word-highlight" position="bottom" fontSize={50} color="#ffffff" />,
      )
      const active = (html.match(/<span[^>]*>[^<]*<\/span>/g) ?? []).find((s) => s.endsWith("> re-prompting.</span>"))
      expect(active).toBeDefined()
      expect(active).not.toContain("scale(1.15)")
      const scale = Number(/scale\(([\d.]+)\)/.exec(active!)?.[1])
      expect(scale).toBeGreaterThan(1)
      expect(scale).toBeLessThan(1.06)
    })

    it("sizes the line from the frame width and font size (overlay -> budget wiring)", () => {
      // Same words, same frame, a 200px font: the budget drops to ~14 chars, so the
      // visible line is the LAST short group and the first word is off screen.
      const html = renderToStaticMarkup(
        <CaptionOverlay captions={eight} style="word-highlight" position="bottom" fontSize={200} color="#ffffff" />,
      )
      expect(html).toContain("hotel")
      expect(html).not.toContain("alpha")
    })
  })

  // Karaoke wipes each word with a stacked SOLID-fill clone (rest underneath,
  // spoken on top clipped to the progress edge) instead of a background-clip
  // gradient — so the look's outline stroke reads over a solid fill. At frame 30
  // (ms=1000) both fixture words are fully spoken → t=1 → hidden=0 → clip fully
  // open, clone painted in the spoken colour.
  it("karaoke renders spoken clones in the highlight colour, clipped to progress", () => {
    const html = renderToStaticMarkup(
      <CaptionOverlay captions={fixture} style="karaoke" position="bottom" fontSize={32} color="#ffffff" highlightColor="#FFE600" />,
    )
    const clones = (html.match(/<span[^>]*>[^<]*<\/span>/g) ?? []).filter((s) => s.includes("position:absolute"))
    expect(clones.length).toBe(2) // one spoken clone per fixture word
    for (const c of clones) {
      expect(c).toContain("clip-path:inset(0 0% 0 0)") // fully revealed
      expect(c).toContain("color:#FFE600") // spoken = highlightColor
      expect(c).toContain("white-space:pre") // trap: clone width must match the base
    }
    // The gradient/transparent-fill model is gone.
    expect(html).not.toContain("background-clip")
    expect(html).not.toContain("-webkit-text-fill-color")
  })

})
