import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Caption } from "@remotion/captions"

// Drive the overlays deterministically: pin the frame (frame 3 @ 30fps = 100ms)
// and the composition size. `importOriginal` keeps the REAL `interpolate`, so the
// karaoke sweep vs. discrete-fill difference below is exercised against the
// production math, not a hand-rolled stand-in.
vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => 3,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 300 }),
}))

// eslint-disable-next-line import/first
import { WordHighlightOverlay } from "../word-highlight-overlay"
// eslint-disable-next-line import/first
import { SubtitleOverlay } from "../subtitle-overlay"
// eslint-disable-next-line import/first
import { KaraokeOverlay } from "../karaoke-overlay"

const cap = (text: string, startMs: number, endMs: number): Caption =>
  ({ text, startMs, endMs, timestampMs: startMs, confidence: null })

// Two words on ONE line at a small size on a 1080 frame → they group together.
// At 100ms the first word ("No") is the active/spoken one, the second ("way")
// has not started (its startMs 500 > 100).
const CAPTIONS: Caption[] = [cap("No", 0, 500), cap("way", 500, 1000)]

describe("WordHighlightOverlay — animate switches the active-word size hop", () => {
  it("animate default (unset) scales the active word UP (the pop)", () => {
    const html = renderToStaticMarkup(
      <WordHighlightOverlay captions={CAPTIONS} position="bottom" fontSize={40} color="#ffffff" />,
    )
    // "No" is short, so it takes the full pop → ACTIVE_WORD_MAX_SCALE (1.15).
    expect(html).toContain("scale(1.15)")
  })

  it("animate:false freezes the active word at scale(1) — no size hop", () => {
    const html = renderToStaticMarkup(
      <WordHighlightOverlay captions={CAPTIONS} position="bottom" fontSize={40} color="#ffffff" animate={false} />,
    )
    // No scaled-up transform anywhere; every word sits at scale(1).
    expect(html).not.toMatch(/scale\(1\.\d/)
    expect(html).toContain("scale(1)")
  })
})

describe("SubtitleOverlay — groups words into a phrase line and renders the JOINED text", () => {
  it("renders one line's joined text ('No way'), not a single word", () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay captions={CAPTIONS} position="bottom" fontSize={40} color="#ffffff" />,
    )
    // The two per-word captions are grouped and joined into one readable line.
    expect(html).toContain("No way")
  })
})

describe("KaraokeOverlay — animate:false is a discrete per-word fill (no intra-word sweep)", () => {
  it("animate:false fully reveals the active word at its start (clip inset 0%)", () => {
    const html = renderToStaticMarkup(
      <KaraokeOverlay captions={CAPTIONS} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" animate={false} />,
    )
    // Discrete: the spoken word is fully filled the instant it starts → 0% clipped.
    expect(html).toContain("inset(0 0% 0 0)")
  })

  it("animate default sweeps the active word mid-fill (a partial clip, not 0%)", () => {
    const html = renderToStaticMarkup(
      <KaraokeOverlay captions={CAPTIONS} position="bottom" fontSize={40} color="#ffffff" highlightColor="#FFE600" />,
    )
    // Continuous: at 100ms into "No"'s [0,500] window the fill is ~20% → 80% clipped.
    expect(html).toContain("inset(0 80% 0 0)")
    expect(html).not.toContain("inset(0 0% 0 0)")
  })
})
