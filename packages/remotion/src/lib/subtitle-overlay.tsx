import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { Caption } from "@remotion/captions"
import { type OverlayPosition } from "./overlay-position"
import { captionAnchorStyle, captionLookStyle, captionWord, type CaptionLook } from "./caption-look"
import { activeCaptionLine, captionLineCharBudget, groupCaptionLines } from "./caption-lines"
import { rowDirectionFromCaptions } from "./text-direction"

export interface OverlayCommonProps extends CaptionLook {
  captions: readonly Caption[]
  position: OverlayPosition
  fontSize: number
  color: string
  backgroundColor?: string
}

/**
 * Static subtitle: one phrase LINE at a time, centered. Words are grouped into
 * lines that fit the frame at this font size/face and each line is HELD through
 * gaps — the SAME line grouping as the kinetic word-highlight overlay
 * (`caption-lines`), single-sourced. So a per-word `captions[]` or transcription
 * renders as readable subtitle lines instead of flashing one word at a time,
 * and a caller-supplied phrase block (one multi-word Caption) stays one line.
 * No per-word animation — this is the static path (the `animate` lever is inert
 * here).
 */
export const SubtitleOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, uppercase, positionY, maxWordsPerLine,
}) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const ms = (frame / fps) * 1000
  // 700 mirrors the row's own weight below (what renders when the look pins
  // none), so the width budget is measured against the face that paints.
  const lines = useMemo(
    () => groupCaptionLines(
      captions,
      captionLineCharBudget({ frameWidth: width, fontSize, fontFamily, fontWeight: fontWeight ?? 700, uppercase }),
      // DELIBERATELY no `splitToWidth` — do not "align" this with the three
      // kinetic overlays. They paint each entry as an atomic `white-space: pre`
      // inline-block that cannot wrap, so an over-wide entry must be split;
      // this one joins the line's words into ONE `white-space: pre-line` string
      // that the browser wraps for real, and a subtitle SEGMENT deliberately
      // shows its joined words as a single block. Which overlays pass the gate
      // is pinned by RENDERED output in
      // `__tests__/caption-overlay-lines.test.tsx` ("a phrase entry wider than
      // the line budget"): adding it here fails that suite.
      { maxWords: maxWordsPerLine },
    ),
    [captions, width, fontSize, fontFamily, fontWeight, uppercase, maxWordsPerLine],
  )
  const hit = activeCaptionLine(lines, ms)
  if (!hit) return null
  // Join the line's words back into one phrase; captionWord adds the single
  // inter-word space (and none before the first word).
  const text = hit.line.words.map((w, i) => captionWord(w.text, i)).join("")
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      // pre-line: a caller's "\n" (a phrase-block Caption) is a forced break.
      fontSize, color, fontWeight: 700, lineHeight: uppercase ? 1.1 : 1.2, whiteSpace: "pre-line",
      textShadow: "0 2px 4px rgba(0,0,0,0.6)",
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // Whole-list base direction so word order follows the language (a Hebrew
      // line opening with a Latin brand token still lays out RTL) — matches the
      // kinetic overlays.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {text}
    </div>
  )
}
