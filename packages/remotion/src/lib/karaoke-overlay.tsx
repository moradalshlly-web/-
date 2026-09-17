import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionTop, captionLookStyle } from "./caption-look"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** Sentence visible; each word fills with the fill colour over its
 *  [startMs, endMs] window. `highlightColor` overrides that fill; otherwise the
 *  plan's `color` is the fill, exactly as before. */
export const KaraokeOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, strokeColor, strokeWidth, highlightColor, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  if (captions.length === 0) return null
  const fill = highlightColor ?? color
  const startMs = captions[0]!.startMs
  const endMs = captions[captions.length - 1]!.endMs
  if (ms < startMs || ms > endMs) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: captionTop(position, positionY),
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color: "#777", fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // Joined full-line text drives the row's base direction so word order
      // (not just per-word glyph shaping) follows the language, reordering
      // sibling word <span>s visually without touching DOM/timing order —
      // see the logoRowDirection pattern in blueprints/logo-assemble-lockup.tsx.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {captions.map((c, i) => {
        const t = interpolate(ms, [c.startMs, c.endMs], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        return (
          <span key={i} style={{
            background: `linear-gradient(90deg, ${fill} ${t * 100}%, #777 ${t * 100}%)`,
            WebkitBackgroundClip: "text", backgroundClip: "text",
            WebkitTextFillColor: "transparent", color: "transparent",
            ...directionStyle(c.text),
          }}>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
