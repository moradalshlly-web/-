import type React from "react"
import { FONT_MAP, withRtlFallback } from "./font-registry"
import { CAPTION_EDGE_INSET, type OverlayPosition } from "./overlay-position"

/**
 * Optional per-render caption look shared by every kinetic overlay: font face,
 * outline, spoken-word colour, casing and a free vertical position. EVERY field
 * is optional, and the two helpers below are no-ops when a field is unset — so a
 * plan that sets none of them renders byte-identically to before this existed.
 */
export interface CaptionLook {
  /** A display name from @nodaro/shared SUPPORTED_FONT_NAMES (e.g. "Montserrat").
   *  Resolved to the loaded webfont via FONT_MAP; unknown names pass through as
   *  a raw family so a caller is never hard-blocked by a typo. */
  readonly fontFamily?: string
  /** Font weight (100-900). Overrides the overlay's hardcoded weight. */
  readonly fontWeight?: number
  readonly strokeColor?: string
  /** Outline width in px; 0 / unset = no outline. */
  readonly strokeWidth?: number
  /** The colour of the word being spoken/active. Used by tiktok-words and, via
   *  `captionRowColors`, by karaoke and word-highlight (whose REST text falls
   *  back to `color` dimmed when no highlight colour is set). */
  readonly highlightColor?: string
  readonly uppercase?: boolean
  /** 0-100, % of composition height — a free vertical position. */
  readonly positionY?: number
  /** Hard cap on WORDS per caption LINE (or tiktok page), on top of the width
   *  budget / sentence end / pause rules. Words are whitespace-separated, so a
   *  phrase-level caption entry counts for all of its words and one holding more
   *  than the cap is split into sub-phrases (see `splitToWordCap` in
   *  `caption-lines`). Unset = width and phrasing alone. Inert on `word-pop`,
   *  which is one word wide by construction. */
  readonly maxWordsPerLine?: number
  /** Per-word MOTION switch (default true). false freezes the geometric
   *  animation — word-highlight's active-word size hop, karaoke's sweep, the
   *  tiktok/word-pop/bouncy springs — while keeping line grouping, holding and
   *  the spoken-word highlight COLOUR. Set highlight_color=color to also flatten
   *  the colour for a fully static line. Inert on the static `subtitle` style. */
  readonly animate?: boolean
}

/** Where a caption block anchors: a top/bottom/positionY inset and the vertical
 *  transform. A named `top`/`bottom` slot anchors the block's NEAR edge (grows
 *  down / up) so a multi-line block never clips; `center` and an explicit
 *  `positionY` centre the block (translateY -50%) as before. */
export interface CaptionAnchor {
  readonly top?: string
  readonly bottom?: string
  readonly translate: string
}

export function captionAnchor(position: OverlayPosition, positionY?: number): CaptionAnchor {
  if (positionY !== undefined && !Number.isNaN(positionY)) {
    return { top: `${Math.min(100, Math.max(0, positionY))}%`, translate: "translateY(-50%)" }
  }
  if (position === "top") return { top: CAPTION_EDGE_INSET.top, translate: "" }
  if (position === "bottom") return { bottom: CAPTION_EDGE_INSET.bottom, translate: "" }
  return { top: "50%", translate: "translateY(-50%)" } // center
}

/** The anchor as spreadable CSS (top/bottom + transform). Overlays that add a
 *  scale to the transform use `captionAnchor` directly instead. */
export function captionAnchorStyle(position: OverlayPosition, positionY?: number): React.CSSProperties {
  const a = captionAnchor(position, positionY)
  return {
    ...(a.top !== undefined ? { top: a.top } : {}),
    ...(a.bottom !== undefined ? { bottom: a.bottom } : {}),
    ...(a.translate ? { transform: a.translate } : {}),
  }
}

/**
 * The visible text for ONE word-span in a multi-word caption row (word-highlight,
 * karaoke, bouncy, tiktok token highlight). Word-level `captions[]` arrive as
 * bare words with no delimiter, while `@remotion/captions` transcription carries
 * a leading-space delimiter; BOTH are normalised here to exactly one separating
 * space so adjacent inline / inline-block words never render glued
 * ("facedoesn'tdrift.Notonce."). The first word in a row gets no leading space.
 * Spans that set `whiteSpace: "pre"` keep this space at their line-box start;
 * plain inline spans render it as ordinary inter-word whitespace.
 */
export function captionWord(text: string, index: number): string {
  const word = text.trim()
  return index === 0 ? word : ` ${word}`
}

/** How far the REST (unspoken) text is dimmed toward black when there is no
 *  distinct highlight colour to separate the spoken word by hue. 55% of white
 *  ≈ #8c8c8c, between the legacy hardcoded greys (#777 karaoke / #aaa
 *  word-highlight) these two overlays used before the look system. */
export const CAPTION_REST_MIX_PERCENT = 55

/**
 * Spoken vs rest colours for the two "row with a spoken cursor" overlays
 * (karaoke, word-highlight). The spoken/active word is `highlightColor ?? color`.
 * The rest is the FULL `color` when a highlight colour exists (the two words
 * separate by HUE — e.g. outline's white row + yellow spoken word), otherwise
 * `color` dimmed toward black so they separate by LUMINANCE (the classic
 * dim→bright karaoke read) — derived from `color` instead of a hardcoded grey,
 * so the caller's colour is honoured either way. An OPAQUE `color-mix` (not
 * `opacity`, which would also dim the black outline, and not an alpha fill,
 * whose transparency lets the stroke's inner half bleed through the glyph).
 */
export function captionRowColors(color: string, highlightColor?: string): { spoken: string; rest: string } {
  return {
    spoken: highlightColor ?? color,
    rest: highlightColor ? color : `color-mix(in srgb, ${color} ${CAPTION_REST_MIX_PERCENT}%, #000000)`,
  }
}

/**
 * Font + outline + casing shared by every caption overlay. Returns an EMPTY
 * object when the look sets none of them, so spreading it is a no-op on the
 * default path. `paintOrder: "stroke fill"` paints the outline BEHIND the glyph,
 * so a thick stroke thickens the letter instead of eating into it (the plain
 * -webkit-text-stroke behaviour). `-webkit-text-stroke-*` and `paint-order` are
 * inherited properties, so setting them on the row container reaches the per-word
 * <span>s the word-level overlays render.
 */
export function captionLookStyle(look: CaptionLook): React.CSSProperties {
  const family = look.fontFamily
    ? withRtlFallback(FONT_MAP[look.fontFamily] ?? look.fontFamily)
    : undefined
  const stroke: React.CSSProperties =
    look.strokeWidth && look.strokeWidth > 0
      ? {
          WebkitTextStrokeWidth: `${look.strokeWidth}px`,
          WebkitTextStrokeColor: look.strokeColor ?? "#000000",
          paintOrder: "stroke fill",
        }
      : {}
  return {
    // fontSynthesis: "none" only when a face is chosen. The overlays hardcode
    // heavy weights (700/800/900) but several faces load ONE weight (Anton /
    // Bebas Neue / Pacifico = 400) or lack 800/900 (Oswald, …). Without this,
    // headless Chrome SYNTHESISES the missing weight (a faux-bold smear that
    // the stroke then traces); "none" renders the face's real nearest weight
    // instead. Absent on the default path, so the no-font render is unchanged.
    ...(family ? { fontFamily: family, fontSynthesis: "none" } : {}),
    ...(look.fontWeight ? { fontWeight: look.fontWeight } : {}),
    ...(look.uppercase ? { textTransform: "uppercase" } : {}),
    ...stroke,
  }
}
