import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_CAPTION_STYLES } from "@nodaro/shared"

// One overlay file per caption style (subtitle + the five kinetic styles). The
// count is pinned to ALL_CAPTION_STYLES below, so adding a caption style without
// adding its overlay here fails the build — which then forces the "consumes the
// look" assertions on the new overlay. This is the guard against the recurring
// "a lever arrives and is silently dropped" bug: every overlay MUST route its
// vertical position through captionTop and its font/outline/casing through
// captionLookStyle.
const CAPTION_OVERLAY_FILES = [
  "subtitle-overlay",
  "word-highlight-overlay",
  "karaoke-overlay",
  "tiktok-pages-overlay",
  "word-pop-overlay",
  "bouncy-overlay",
]

describe("every caption overlay consumes the shared look", () => {
  it("has exactly one overlay per caption style (a new style forces a new overlay here)", () => {
    expect(CAPTION_OVERLAY_FILES.length).toBe(ALL_CAPTION_STYLES.length)
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx routes vertical position through captionTop", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("captionTop(position")
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx applies captionLookStyle (font / outline / casing)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("captionLookStyle(")
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx no longer hardcodes POSITION_Y (positionY must win)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).not.toContain("POSITION_Y[position]")
  })
})
