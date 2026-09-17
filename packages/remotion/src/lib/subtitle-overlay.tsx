import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { Caption } from "@remotion/captions"
import { type OverlayPosition } from "./overlay-position"
import { captionTop, captionLookStyle, type CaptionLook } from "./caption-look"
import { directionStyle } from "./text-direction"

export interface OverlayCommonProps extends CaptionLook {
  captions: readonly Caption[]
  position: OverlayPosition
  fontSize: number
  color: string
  backgroundColor?: string
}

/** Sentence-level subtitle: shows one Caption at a time, centered. */
export const SubtitleOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, strokeColor, strokeWidth, uppercase, positionY,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const active = captions.find((c) => ms >= c.startMs && ms <= c.endMs)
  if (!active) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: captionTop(position, positionY),
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color, fontWeight: 700, lineHeight: 1.2,
      textShadow: "0 2px 4px rgba(0,0,0,0.6)",
      ...captionLookStyle({ fontFamily, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      ...directionStyle(active.text),
    }}>
      {active.text}
    </div>
  )
}
