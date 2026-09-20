import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionRowColors, captionWord } from "./caption-look"
import { directionStyle, resolveDirection, rowDirectionFromCaptions } from "./text-direction"

/** Sentence visible; each word wipes from the rest colour to the spoken colour
 *  over its [startMs, endMs] window. Colours come from `captionRowColors`
 *  (spoken = highlightColor ?? color; rest = color, dimmed when no highlight).
 *
 *  The wipe is TWO stacked SOLID-fill spans (rest underneath, spoken on top
 *  clipped to the progress edge) — NOT a background-clip gradient. Both layers
 *  inherit the look's `-webkit-text-stroke` + `paint-order` from the container,
 *  so the outline reads correctly; a transparent-fill gradient let the stroke's
 *  inner half bleed over the glyph (it has no solid fill to paint behind). */
export const KaraokeOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, animate,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  if (captions.length === 0) return null
  const { spoken, rest } = captionRowColors(color, highlightColor)
  const startMs = captions[0]!.startMs
  const endMs = captions[captions.length - 1]!.endMs
  if (ms < startMs || ms > endMs) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      fontSize, color: rest, fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // Joined full-line text drives the row's base direction so word order
      // (not just per-word glyph shaping) follows the language, reordering
      // sibling word <span>s visually without touching DOM/timing order —
      // see the logoRowDirection pattern in blueprints/logo-assemble-lockup.tsx.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {captions.map((c, i) => {
        // animate:false replaces the intra-word sweep with a discrete per-word
        // fill (spoken once the word starts) — no per-frame motion.
        const t = animate === false
          ? (ms >= c.startMs ? 1 : 0)
          : interpolate(ms, [c.startMs, c.endMs], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        const hidden = (1 - t) * 100
        // Reveal from the reading edge: LTR clips the RIGHT away, RTL the LEFT.
        const dir = resolveDirection(c.text)
        const clip = dir === "rtl" ? `inset(0 0 0 ${hidden}%)` : `inset(0 ${hidden}% 0 0)`
        const word = captionWord(c.text, i)
        return (
          // Base (rest colour) with the spoken clone stacked exactly on top; both
          // solid fills, both inherit the stroke, so the clone's clipped stroke
          // sits over the base's identical stroke — no seam at the wipe edge.
          <span key={i} style={{ display: "inline-block", position: "relative", whiteSpace: "pre", color: rest, ...directionStyle(c.text) }}>
            {word}
            <span aria-hidden style={{
              position: "absolute", inset: 0, whiteSpace: "pre", color: spoken,
              pointerEvents: "none", clipPath: clip,
              ...directionStyle(c.text),
            }}>
              {word}
            </span>
          </span>
        )
      })}
    </div>
  )
}
