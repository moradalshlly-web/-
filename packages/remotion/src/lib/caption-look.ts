import type React from "react"
import { FONT_MAP, withRtlFallback } from "./font-registry"
import { POSITION_Y, type OverlayPosition } from "./overlay-position"

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
  readonly strokeColor?: string
  /** Outline width in px; 0 / unset = no outline. */
  readonly strokeWidth?: number
  /** The word being spoken (per-word styles only, e.g. tiktok-words). */
  readonly highlightColor?: string
  readonly uppercase?: boolean
  /** 0-100, % of composition height — a free vertical position. */
  readonly positionY?: number
}

/**
 * `positionY` (0-100, % of composition height) wins over the three named slots,
 * so captions can sit at the ~two-thirds line every TikTok/Reels edit uses —
 * below the face, above the app's own bottom UI. Falls back to the named slot
 * when unset, so the default render is unchanged.
 */
export function captionTop(position: OverlayPosition, positionY?: number): string {
  if (positionY === undefined || Number.isNaN(positionY)) return POSITION_Y[position]
  return `${Math.min(100, Math.max(0, positionY))}%`
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
    ...(look.uppercase ? { textTransform: "uppercase" } : {}),
    ...stroke,
  }
}
