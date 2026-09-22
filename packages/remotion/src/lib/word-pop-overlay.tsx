import React from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchor, captionLookStyle } from "./caption-look"
import { activeHeldCaption, captionEnterFrame } from "./caption-lines"
import { directionStyle } from "./text-direction"

/** Render exactly one word at a time, springing in as it starts.
 *  The word is HELD until the next one starts (capped at
 *  `CAPTION_LINE_MAX_HOLD_MS` past its own end) — a membership test on each
 *  word's [startMs, endMs] rendered NOTHING in every inter-word gap, and on a
 *  real clip those gaps run 40-700 ms, so the caption strobed. `maxWordsPerLine`
 *  is inert here: this overlay is one word wide by construction. */
export const WordPopOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, uppercase, positionY, animate,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const active = activeHeldCaption(captions, ms)
  if (!active) return null
  const localFrame = captionEnterFrame(active.startMs, frame, fps)
  // animate:false drops the per-word pop spring — the word just appears. So does a
  // word whose startMs is not a usable number (spring throws on a NaN frame):
  // the word is drawn at rest rather than failing the render.
  const enter = animate === false || localFrame === null
    ? 1
    : spring({ frame: localFrame, fps, config: { damping: 8, stiffness: 250 } })
  const anchor = captionAnchor(position, positionY)
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...(anchor.top !== undefined ? { top: anchor.top } : {}),
      ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : {}),
      transform: `${anchor.translate} scale(${enter})`.trim(),
      textAlign: "center", fontSize: fontSize * 1.4,
      color, fontWeight: 900, lineHeight: 1, letterSpacing: "0.02em",
      textShadow: "0 4px 8px rgba(0,0,0,0.4)",
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.2em 0.5em", borderRadius: "0.4em", display: "inline-block" } : {}),
      ...directionStyle(active.text),
    }}>
      {active.text.trim()}
    </div>
  )
}
