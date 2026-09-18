import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionRowColors, captionWord } from "./caption-look"
import { activeCaptionLine, captionLineCharBudget, groupCaptionLines } from "./caption-lines"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** Renders ONE LINE of words at a time; the word being spoken is colored/scaled
 *  up. The words are grouped into lines by `caption-lines` to fit the frame
 *  width at this font size and face, and the line is HELD through pauses — a
 *  word's [startMs, endMs] drives the highlight, never whether text is on
 *  screen. (It used to render a sliding window of the active word +/- 2, which
 *  went blank in every inter-word pause and wrapped to two lines at a heavy
 *  uppercase face.)
 *  Colours come from `captionRowColors`: the active word is `highlightColor ??
 *  color`, the rest is `color` (dimmed toward black when there is no highlight
 *  colour) — so the plan's `color` is honoured on both. */
export const WordHighlightOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const { spoken, rest } = captionRowColors(color, highlightColor)
  // 700 mirrors the row's own hardcoded weight below, which is what renders
  // when the look pins no weight — so the budget is measured against the face
  // that actually paints.
  const lines = useMemo(
    () => groupCaptionLines(
      captions,
      captionLineCharBudget({ frameWidth: width, fontSize, fontFamily, fontWeight: fontWeight ?? 700, uppercase }),
    ),
    [captions, width, fontSize, fontFamily, fontWeight, uppercase],
  )
  const hit = activeCaptionLine(lines, ms)
  if (!hit) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      fontSize, color: rest, fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      // The WHOLE caption list (not just the visible line) drives the row's base
      // direction, so word order follows the LANGUAGE of the piece: a Hebrew /
      // Arabic line that happens to open with a Latin token (a brand name) must
      // still lay out RTL — detecting per line flipped it to LTR and reversed
      // its word order. Reorders sibling word <span>s visually without touching
      // DOM/timing order (the logoRowDirection pattern in
      // blueprints/logo-assemble-lockup.tsx). No white-space: nowrap here: if
      // the width estimate is ever short, a natural wrap is the fallback.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {hit.line.words.map((c, i) => {
        const isActive = i === hit.activeIndex
        return (
          <span key={i} style={{
            color: isActive ? spoken : rest,
            transform: isActive ? "scale(1.15)" : "scale(1)",
            display: "inline-block",
            // An inline-block starts its own line box, so CSS removes the
            // collapsible leading space that is the @remotion/captions word
            // delimiter — words rendered glued ("Twopeopletalking"). pre keeps it.
            whiteSpace: "pre",
            ...(isActive && backgroundColor ? { background: backgroundColor, padding: "0.05em 0.2em", borderRadius: "0.3em" } : {}),
            ...directionStyle(c.text),
          }}>
            {captionWord(c.text, i)}
          </span>
        )
      })}
    </div>
  )
}
