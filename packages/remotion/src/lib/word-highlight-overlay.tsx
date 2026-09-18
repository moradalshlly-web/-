import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionRowColors, captionWord } from "./caption-look"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** Renders a window of N adjacent words; the active one is colored/scaled up.
 *  Colours come from `captionRowColors`: the active word is `highlightColor ??
 *  color`, the rest is `color` (dimmed toward black when there is no highlight
 *  colour) — so the plan's `color` is honoured on both. */
export const WordHighlightOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const { spoken, rest } = captionRowColors(color, highlightColor)
  const activeIdx = captions.findIndex((c) => ms >= c.startMs && ms <= c.endMs)
  if (activeIdx < 0) return null
  const window = captions.slice(Math.max(0, activeIdx - 2), Math.min(captions.length, activeIdx + 3))
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      fontSize, color: rest, fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      // Joined full-line text (not just the visible window) drives the row's
      // base direction so word order follows the language, reordering sibling
      // word <span>s visually without touching DOM/timing order — see the
      // logoRowDirection pattern in blueprints/logo-assemble-lockup.tsx.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {window.map((c, i) => {
        const isActive = c === captions[activeIdx]
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
