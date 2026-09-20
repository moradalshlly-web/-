import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionRowColors, captionWord } from "./caption-look"
import { CAPTION_WORD_PAD_EM, activeCaptionLine, activeWordScale, captionLineCharBudget, groupCaptionLines } from "./caption-lines"
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
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, animate,
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
            // The pop grows the word around its centre with NO layout space of its
            // own, so every word carries a fixed padding and the scale is bounded to
            // fit inside it — a long active word used to swallow the space before it
            // ("Nore-prompting."). Constant padding = no layout shift as the
            // highlight moves.
            padding: `0 ${CAPTION_WORD_PAD_EM}em`,
            // animate:false freezes the active-word size hop (keeps the colour
            // highlight); with highlight_color=color the whole held line is then
            // pixel-static.
            transform: isActive && animate !== false
              ? `scale(${activeWordScale(c.text, { fontFamily, fontWeight: fontWeight ?? 700, uppercase })})`
              : "scale(1)",
            display: "inline-block",
            // An inline-block starts its own line box, so CSS removes the
            // collapsible leading space that is the @remotion/captions word
            // delimiter — words rendered glued ("Twopeopletalking"). pre keeps it.
            whiteSpace: "pre",
            // The pill keeps the SAME horizontal padding as every word, so the row does not
            // shift sideways as the highlight moves.
            ...(isActive && backgroundColor ? { background: backgroundColor, padding: `0.05em ${CAPTION_WORD_PAD_EM}em`, borderRadius: "0.3em" } : {}),
            ...directionStyle(c.text),
          }}>
            {captionWord(c.text, i)}
          </span>
        )
      })}
    </div>
  )
}
