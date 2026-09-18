import type { Caption } from "@remotion/captions"
import { resolveCaptionLook, type CaptionLookId, type CaptionLookLevers, type SupportedFontName } from "@nodaro/shared"
import { syntheticCaptionsFromText } from "../audio/captions-mappers.js"

/**
 * Per-segment captions: a single add-captions render can apply DIFFERENT caption
 * treatments to different time ranges (e.g. a large uppercase phrase at the top
 * for the intro, then one word at a time at the bottom for the body). This
 * resolves each caller-supplied segment into a self-contained render segment —
 * its words and its fully-merged (look → explicit) levers — so the Remotion
 * composition just renders what it is given.
 */

/** Non-look, non-lever placement fields a segment inherits from the top level. */
export interface CaptionStyleDefaults {
  style: string
  position: "top" | "center" | "bottom"
  positionY?: number
  fontSize: number
  /** Top-level look; a segment without its own look inherits it. */
  look?: CaptionLookId
  /** Top-level EXPLICIT levers (what the caller passed, before look resolution);
   *  a segment without its own look inherits these too. */
  explicit: CaptionLookLevers
}

/** One caller-supplied segment (post-Zod). Style/placement + optional look +
 *  explicit lever overrides + optional own words (`text` or `captions[]`). */
export interface CaptionSegmentInput {
  startMs: number
  endMs: number
  style?: string
  position?: "top" | "center" | "bottom"
  positionY?: number
  fontSize?: number
  look?: CaptionLookId
  // Explicit look levers (each overrides the resolved look):
  fontFamily?: SupportedFontName
  fontWeight?: number
  color?: string
  backgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  // Own words:
  text?: string
  captions?: Caption[]
}

/** A fully-resolved segment the render plan carries — concrete levers only, no
 *  `look` left to resolve. */
export interface ResolvedCaptionSegment extends CaptionLookLevers {
  startMs: number
  endMs: number
  style: string
  position: "top" | "center" | "bottom"
  positionY?: number
  fontSize: number
  captions: Caption[]
}

/** Pull just the explicit lever fields off an input — only the DEFINED ones, so
 *  the result can be spread over another lever set without clobbering it with
 *  undefined. */
export function explicitLevers(o: {
  fontFamily?: SupportedFontName; fontWeight?: number; color?: string; backgroundColor?: string
  strokeColor?: string; strokeWidth?: number; highlightColor?: string; uppercase?: boolean
}): CaptionLookLevers {
  return {
    ...(o.fontFamily !== undefined ? { fontFamily: o.fontFamily } : {}),
    ...(o.fontWeight !== undefined ? { fontWeight: o.fontWeight } : {}),
    ...(o.color !== undefined ? { color: o.color } : {}),
    ...(o.backgroundColor !== undefined ? { backgroundColor: o.backgroundColor } : {}),
    ...(o.strokeColor !== undefined ? { strokeColor: o.strokeColor } : {}),
    ...(o.strokeWidth !== undefined ? { strokeWidth: o.strokeWidth } : {}),
    ...(o.highlightColor !== undefined ? { highlightColor: o.highlightColor } : {}),
    ...(o.uppercase !== undefined ? { uppercase: o.uppercase } : {}),
  }
}

/**
 * Resolve each segment's words and merged levers.
 *
 * Words, in priority order:
 *   1. the segment's own `captions[]` — verbatim (ABSOLUTE video-timeline ms,
 *      like the top-level captions; a word outside the segment's own range is
 *      gated out at render);
 *   2. else its own `text` — for a `subtitle` segment ONE phrase block spanning
 *      the segment's range (use `\n` to force line breaks); for a kinetic style,
 *      synthesised one word at a time;
 *   3. else the shared transcript — each word assigned to the ONE segment whose
 *      range contains its START (no straddling / mid-word style jump). For a
 *      `subtitle` segment the range's words are joined into one phrase block.
 *
 * Levers: the segment's `look` (or the top-level look it inherits) resolved
 * under its explicit overrides. `color` / `backgroundColor` are BASE caption
 * fields (not look levers) and ALWAYS inherit the top-level value when the
 * segment doesn't set its own. The LOOK-specific levers (font / weight / outline
 * / spoken-word / casing) reset when a segment names its OWN look — it does NOT
 * inherit the top-level ones — but a segment without a look inherits all of them.
 */
export function resolveCaptionSegments(
  sharedCaptions: readonly Caption[],
  segments: readonly CaptionSegmentInput[],
  defaults: CaptionStyleDefaults,
): ResolvedCaptionSegment[] {
  return segments.map((seg): ResolvedCaptionSegment => {
    const style = seg.style ?? defaults.style
    const fontSize = seg.fontSize ?? defaults.fontSize

    const block = (text: string): Caption => ({
      text: text.trim(),
      startMs: seg.startMs,
      endMs: seg.endMs,
      timestampMs: seg.startMs,
      confidence: null,
    })
    let captions: Caption[]
    if (seg.captions && seg.captions.length > 0) {
      captions = seg.captions
    } else if (seg.text) {
      captions = style === "subtitle"
        ? [block(seg.text)]
        : syntheticCaptionsFromText(seg.text, { startMs: seg.startMs, endMs: seg.endMs })
    } else {
      const shared = sharedCaptions.filter((c) => c.startMs >= seg.startMs && c.startMs < seg.endMs)
      captions = style === "subtitle" && shared.length > 0
        ? [block(shared.map((c) => c.text.trim()).join(" "))]
        : shared
    }

    const segExplicit = explicitLevers(seg)
    const look = seg.look ?? defaults.look
    // `color` / `backgroundColor` are BASE caption fields, not kinetic-only look
    // levers (they apply to subtitle too, and are absent from
    // KINETIC_ONLY_CAPTION_LEVER_KEYS) — so they ALWAYS inherit the top-level value
    // when the segment doesn't set its own, regardless of the segment's look.
    const inheritedBase: CaptionLookLevers = {
      ...(defaults.explicit.color !== undefined ? { color: defaults.explicit.color } : {}),
      ...(defaults.explicit.backgroundColor !== undefined ? { backgroundColor: defaults.explicit.backgroundColor } : {}),
    }
    // A segment that names its OWN look starts fresh from that preset's LOOK levers
    // (font / weight / outline / spoken-word / casing) — it does NOT inherit the
    // top-level LOOK levers — but keeps the inherited base above; a segment without
    // a look inherits the whole top-level explicit set. Both sides are only-defined,
    // so the spread never clobbers with undefined.
    const explicit = seg.look
      ? { ...inheritedBase, ...segExplicit }
      : { ...defaults.explicit, ...segExplicit }
    const levers = resolveCaptionLook(look, explicit, fontSize)

    return {
      startMs: seg.startMs,
      endMs: seg.endMs,
      style,
      position: seg.position ?? defaults.position,
      positionY: seg.positionY ?? defaults.positionY,
      fontSize,
      ...levers,
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
