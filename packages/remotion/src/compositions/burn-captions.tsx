import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion"
import { TimelineClip } from "../lib/timeline-clip"
import { CaptionOverlay } from "../lib/caption-overlay"
import type { BurnCaptionsSegment } from "../types"
// Side-effect import: font-registry's module-level loadFont() calls register
// every SUPPORTED_FONT_NAMES face so a plan's fontFamily actually resolves in
// the headless render (an unloaded family silently falls back). The overlays
// reach it transitively via caption-look, but this makes the dependency
// explicit so a future `import type` refactor can't quietly unload the fonts —
// the same pattern lottie-*-renderer.tsx already use.
import "../lib/font-registry"
import type { BurnCaptionsInputProps } from "../types"

/**
 * Renders ONE resolved segment, but only while the playhead is inside its
 * [startMs, endMs) — so an overlay's own enter/exit animation can't bleed past
 * the segment boundary into its neighbour (the segments never overlap in time).
 */
const SegmentOverlay: React.FC<{ segment: BurnCaptionsSegment }> = ({ segment }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  if (ms < segment.startMs || ms >= segment.endMs) return null
  return (
    <CaptionOverlay
      captions={segment.captions}
      style={segment.style}
      position={segment.position}
      fontSize={segment.fontSize}
      color={segment.color}
      backgroundColor={segment.backgroundColor}
      fontFamily={segment.fontFamily}
      strokeColor={segment.strokeColor}
      strokeWidth={segment.strokeWidth}
      highlightColor={segment.highlightColor}
      uppercase={segment.uppercase}
      positionY={segment.positionY}
    />
  )
}

/**
 * Burns captions onto a base video. Consumed by render-worker via the
 * "burn-captions" planType. inputProps nested under `.plan` to match
 * buildPlanRender's wrapping (render-worker.ts:191). Renders one time-gated
 * overlay per segment when the plan carries `segments`, else a single overlay
 * for the whole video.
 */
export const BurnCaptions: React.FC<BurnCaptionsInputProps> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <TimelineClip src={plan.sourceVideo} />
      {plan.segments && plan.segments.length > 0 ? (
        // Per-segment captions: each segment renders its own words + style,
        // time-gated so only the segment covering the playhead is visible.
        plan.segments.map((segment, i) => <SegmentOverlay key={i} segment={segment} />)
      ) : (
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
      )}
    </AbsoluteFill>
  )
}
