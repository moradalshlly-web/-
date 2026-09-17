import React from "react"
import { AbsoluteFill } from "remotion"
import { TimelineClip } from "../lib/timeline-clip"
import { CaptionOverlay } from "../lib/caption-overlay"
// Side-effect import: font-registry's module-level loadFont() calls register
// every SUPPORTED_FONT_NAMES face so a plan's fontFamily actually resolves in
// the headless render (an unloaded family silently falls back). The overlays
// reach it transitively via caption-look, but this makes the dependency
// explicit so a future `import type` refactor can't quietly unload the fonts —
// the same pattern lottie-*-renderer.tsx already use.
import "../lib/font-registry"
import type { BurnCaptionsInputProps } from "../types"

/**
 * Burns kinetic captions onto a base video. Consumed by render-worker via
 * the "burn-captions" planType. inputProps nested under `.plan` to match
 * buildPlanRender's wrapping (render-worker.ts:191).
 */
export const BurnCaptions: React.FC<BurnCaptionsInputProps> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <TimelineClip src={plan.sourceVideo} />
      <CaptionOverlay
        captions={plan.captions}
        style={plan.style}
        position={plan.position}
        fontSize={plan.fontSize}
        color={plan.color}
        backgroundColor={plan.backgroundColor}
        fontFamily={plan.fontFamily}
        strokeColor={plan.strokeColor}
        strokeWidth={plan.strokeWidth}
        highlightColor={plan.highlightColor}
        uppercase={plan.uppercase}
        positionY={plan.positionY}
      />
    </AbsoluteFill>
  )
}
