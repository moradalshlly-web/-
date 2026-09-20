import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Per-word / per-segment overlays lay out RTL through directionStyle on each
// text node. The static subtitle overlay renders ONE joined phrase line (not a
// row of per-word spans), so its RTL wiring is the row-level base direction
// (rowDirectionFromCaptions) instead — it deliberately no longer imports
// directionStyle, and asserting it would fail (its per-word spans are gone).
const perWordFiles = ["karaoke-overlay", "word-highlight-overlay", "word-pop-overlay",
  "bouncy-overlay", "tiktok-pages-overlay", "scene-text-segment", "text-overlay"]

describe("overlays are RTL-wired", () => {
  it.each(perWordFiles)("%s.tsx imports directionStyle (per-word/segment RTL)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("directionStyle")
  })

  it("subtitle-overlay.tsx lays out RTL via the row base direction (single joined line, no per-word spans)", () => {
    const src = readFileSync(join(__dirname, "..", "subtitle-overlay.tsx"), "utf8")
    expect(src).toContain("rowDirectionFromCaptions(")
  })
})
