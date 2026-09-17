import type { Caption } from "@remotion/captions"
import { syntheticCaptionsFromText } from "../audio/captions-mappers.js"

/**
 * Per-segment captions: a single add-captions render can apply DIFFERENT caption
 * treatments to different time ranges (e.g. a large uppercase phrase at the top
 * for the intro, then one word at a time at the bottom for the body). This
 * resolves each caller-supplied segment into a self-contained render segment —
 * its words and its fully-merged style — so the Remotion composition just
 * renders what it is given.
 */

/** The shared, whole-video style/look — a segment inherits any field it omits. */
export interface CaptionStyleDefaults {
  style: string
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  fontFamily?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
}

/** One caller-supplied segment (post-Zod). Style/look fields are optional
 *  overrides; `captions`/`text` are its optional own words. */
export interface CaptionSegmentInput {
  startMs: number
  endMs: number
  style?: string
  position?: "top" | "center" | "bottom"
  fontSize?: number
  color?: string
  backgroundColor?: string
  fontFamily?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
  text?: string
  captions?: Caption[]
}

/** A fully-resolved segment the render plan carries — no fallback left to do. */
export interface ResolvedCaptionSegment extends CaptionStyleDefaults {
  startMs: number
  endMs: number
  captions: Caption[]
}

/**
 * Resolve each segment's words and merged style.
 *
 * Words, in priority order:
 *   1. the segment's own `captions[]` (verbatim — their `startMs`/`endMs` are
 *      ABSOLUTE video-timeline ms, like the top-level captions, NOT relative to
 *      the segment; a word whose window falls outside the segment's own time
 *      range will be gated out at render);
 *   2. else its own `text`, synthesised evenly across the segment's range;
 *   3. else the shared transcript, each word assigned to the ONE segment whose
 *      range contains the word's START (`startMs`) — so a word straddling a
 *      boundary belongs to a single segment and never jumps style mid-word.
 *
 * Style/look: the segment's value if set, otherwise the shared default.
 */
export function resolveCaptionSegments(
  sharedCaptions: readonly Caption[],
  segments: readonly CaptionSegmentInput[],
  defaults: CaptionStyleDefaults,
): ResolvedCaptionSegment[] {
  return segments.map((seg): ResolvedCaptionSegment => {
    const captions =
      seg.captions && seg.captions.length > 0
        ? seg.captions
        : seg.text
          ? syntheticCaptionsFromText(seg.text, { startMs: seg.startMs, endMs: seg.endMs })
          : sharedCaptions.filter((c) => c.startMs >= seg.startMs && c.startMs < seg.endMs)
    return {
      startMs: seg.startMs,
      endMs: seg.endMs,
      style: seg.style ?? defaults.style,
      position: seg.position ?? defaults.position,
      fontSize: seg.fontSize ?? defaults.fontSize,
      color: seg.color ?? defaults.color,
      backgroundColor: seg.backgroundColor ?? defaults.backgroundColor,
      fontFamily: seg.fontFamily ?? defaults.fontFamily,
      strokeColor: seg.strokeColor ?? defaults.strokeColor,
      strokeWidth: seg.strokeWidth ?? defaults.strokeWidth,
      highlightColor: seg.highlightColor ?? defaults.highlightColor,
      uppercase: seg.uppercase ?? defaults.uppercase,
      positionY: seg.positionY ?? defaults.positionY,
      captions,
    }
  })
}

/**
 * Segments must be sorted and non-overlapping. Returns an error string naming
 * the first offending pair, or null when the set is valid. `startMs < endMs`
 * per segment is enforced by the route Zod; this is the cross-segment rule.
 */
export function findSegmentOverlap(
  segments: readonly { startMs: number; endMs: number }[],
): string | null {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startMs < sorted[i - 1]!.endMs) {
      return `segments overlap: [${sorted[i - 1]!.startMs}, ${sorted[i - 1]!.endMs}) and [${sorted[i]!.startMs}, ${sorted[i]!.endMs})`
    }
  }
  return null
}
