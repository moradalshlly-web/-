import React from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchor, captionLookStyle } from "./caption-look"
import { directionStyle } from "./text-direction"

/** Render exactly one word at a time, springing in then out. */
export const WordPopOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const active = captions.find((c) => ms >= c.startMs && ms <= c.endMs)
  if (!active) return null
  const localFrame = frame - (active.startMs / 1000) * fps
  const enter = spring({ frame: localFrame, fps, config: { damping: 8, stiffness: 250 } })
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
