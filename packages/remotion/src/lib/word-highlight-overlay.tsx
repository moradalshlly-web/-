import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionTop, captionLookStyle } from "./caption-look"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** Renders a window of N adjacent words; the active one is colored/scaled up.
 *  `highlightColor` overrides the active-word colour; otherwise the plan's
 *  `color` is used, exactly as before. */
export const WordHighlightOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, strokeColor, strokeWidth, highlightColor, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const activeColor = highlightColor ?? color
  const activeIdx = captions.findIndex((c) => ms >= c.startMs && ms <= c.endMs)
  if (activeIdx < 0) return null
  const window = captions.slice(Math.max(0, activeIdx - 2), Math.min(captions.length, activeIdx + 3))
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: captionTop(position, positionY),
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color: "#aaa", fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, strokeColor, strokeWidth, uppercase }),
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
            color: isActive ? activeColor : "#aaa",
            transform: isActive ? "scale(1.15)" : "scale(1)",
            display: "inline-block",
            // An inline-block starts its own line box, so CSS removes the
            // collapsible leading space that is the @remotion/captions word
            // delimiter — words rendered glued ("Twopeopletalking"). pre keeps it.
            whiteSpace: "pre",
            ...(isActive && backgroundColor ? { background: backgroundColor, padding: "0.05em 0.2em", borderRadius: "0.3em" } : {}),
            ...directionStyle(c.text),
          }}>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
