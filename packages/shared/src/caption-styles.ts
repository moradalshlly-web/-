import type { SupportedFontName } from "./supported-fonts.js"

/**
 * Caption styles for the add-captions node. Static path uses FFmpeg drawtext;
 * kinetic styles render via Remotion (BurnCaptions composition).
 *
 * Single source of truth — imported by:
 *   - backend route Zod (add-captions.ts)
 *   - backend worker handler (ffmpeg.ts)
 *   - backend MCP tool (verbs-video.ts)
 *   - backend plan schema (plan-schemas.ts)
 *   - frontend node config + cost helper
 *   - packages/remotion overlay dispatcher
 */
export const STATIC_CAPTION_STYLES = ["subtitle"] as const
export const KINETIC_CAPTION_STYLES = [
  "word-highlight",
  "karaoke",
  "tiktok-words",
  "word-pop",
  "bouncy",
] as const
export const ALL_CAPTION_STYLES = [...STATIC_CAPTION_STYLES, ...KINETIC_CAPTION_STYLES] as const

export type StaticCaptionStyle = (typeof STATIC_CAPTION_STYLES)[number]
export type KineticCaptionStyle = (typeof KINETIC_CAPTION_STYLES)[number]
export type CaptionStyle = (typeof ALL_CAPTION_STYLES)[number]

const KINETIC_SET = new Set<string>(KINETIC_CAPTION_STYLES)

export function isKineticCaptionStyle(style: string | undefined | null): style is KineticCaptionStyle {
  return style !== null && style !== undefined && KINETIC_SET.has(style)
}

// ── Named "looks" ──────────────────────────────────────────────────────────
// A look is a bundle of visual levers so a caption reads well with one field
// instead of eight. Shared because the ids are wire contract (route Zod, MCP
// schema, SDK type) and the value table is consumed by BOTH the worker (render)
// and the canvas preview — deliberately given away, not creative doctrine.
export const CAPTION_LOOK_IDS = ["outline", "clean"] as const
export type CaptionLookId = (typeof CAPTION_LOOK_IDS)[number]

/** What an unset `look` means. ONE-LINE FLIP: set to "clean" to make an unset
 *  caption render as the pre-look-system lever set (face pinned) instead. */
export const DEFAULT_CAPTION_LOOK: CaptionLookId = "outline"

/**
 * The lever field names that are MEANINGLESS on a `subtitle` render and so are
 * rejected on it: `highlightColor` (subtitle has no per-word spoken cursor to
 * colour) and `animate` (subtitle has no motion to switch off). The STYLING
 * levers (look/fontFamily/fontWeight/strokeColor/strokeWidth/uppercase/positionY)
 * are NOT here any more — a `subtitle` carrying any of them now routes to the
 * Remotion renderer (see `captionRoutesToRemotion`), which applies them exactly
 * as it does for the kinetic styles. Single source of truth for the route's
 * reject-on-subtitle guard and the frontend's "don't send a stale lever" strip.
 * `color`/`backgroundColor` are deliberately absent — FFmpeg subtitle honours
 * those too.
 */
export const KINETIC_ONLY_CAPTION_LEVER_KEYS = [
  "highlightColor",
  "animate",
] as const
export type KineticOnlyCaptionLeverKey = (typeof KINETIC_ONLY_CAPTION_LEVER_KEYS)[number]

/**
 * Does an add-captions request need the Remotion renderer, vs the cheap static
 * FFmpeg drawtext path? A caption routes to Remotion when it needs anything the
 * one-fixed-string drawtext pass cannot do:
 *   - per-segment treatments (`segments`),
 *   - a kinetic style,
 *   - any STYLING lever (look/font/weight/stroke/uppercase/position_y) — FFmpeg
 *     drawtext can't apply a webfont face, weight, outline, casing, or a free
 *     vertical position,
 *   - TIMED captions (a wired `transcript` or an explicit `captions[]` array),
 *   - auto-transcription, i.e. no `text` to burn as one static block.
 * Plain-`text` `subtitle` with no lever stays on FFmpeg (unchanged, cheap).
 *
 * SINGLE SOURCE for BOTH the worker dispatch (handleAddCaptions) AND the credit
 * id (buildAddCaptionsCreditId) so the renderer and the price never drift: a
 * Remotion render bills as `add-captions:kinetic`, a plain drawtext burn as
 * `add-captions`.
 */
export function captionRoutesToRemotion(input: {
  style?: string | null
  text?: string | null
  segments?: readonly unknown[] | null
  transcript?: unknown
  captions?: readonly unknown[] | null
  look?: unknown
  fontFamily?: unknown
  fontWeight?: unknown
  strokeColor?: unknown
  strokeWidth?: unknown
  uppercase?: unknown
  positionY?: unknown
}): boolean {
  if (input.segments && input.segments.length > 0) return true
  if (isKineticCaptionStyle(input.style)) return true
  // From here the style is `subtitle` (or unset → the subtitle default).
  const hasStylingLever =
    input.look !== undefined ||
    input.fontFamily !== undefined ||
    input.fontWeight !== undefined ||
    input.strokeColor !== undefined ||
    input.strokeWidth !== undefined ||
    input.uppercase !== undefined ||
    input.positionY !== undefined
  if (hasStylingLever) return true
  if (input.transcript !== undefined && input.transcript !== null) return true
  if (input.captions && input.captions.length > 0) return true
  // No `text` to burn as one static block → the only caption source is
  // transcription, which produces TIMED captions the drawtext pass can't show.
  if (!input.text) return true
  return false
}

/** The concrete levers a look (and any explicit override) resolves to. */
export interface CaptionLookLevers {
  fontFamily?: SupportedFontName
  fontWeight?: number
  color?: string
  backgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
}

/** Outline width = 10% of font size (min 2px). `paint-order: stroke fill` puts
 *  half the stroke OUTSIDE the glyph, so the visible rim is ~5% of font size. */
export function autoStrokeWidth(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * 0.1))
}

/** Each look is a function of font size (so the outline tracks the text size). */
export const CAPTION_LOOKS: Record<CaptionLookId, (fontSize: number) => CaptionLookLevers> = {
  // The TikTok / CapCut read: heavy geometric sans, caps, white on a thick black
  // outline, yellow spoken word.
  outline: (fs) => ({
    fontFamily: "Montserrat",
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: autoStrokeWidth(fs),
    highlightColor: "#FFE600",
  }),
  // The pre-look lever set with the face pinned (it never was): per-style weight,
  // soft shadow only, no casing, no outline.
  clean: () => ({ fontFamily: "Inter", color: "#ffffff" }),
}

/**
 * Resolve a look + explicit overrides into concrete levers. An explicit lever
 * always wins over the look; `strokeWidth: 0` explicitly means "no outline".
 * The plan then carries concrete levers only — nothing to resolve at render.
 */
export function resolveCaptionLook(
  look: CaptionLookId | undefined,
  explicit: CaptionLookLevers,
  fontSize: number,
): CaptionLookLevers {
  // COERCE, never throw. The route Zod rejects a bad `look`, but the orchestrator /
  // authored-JSON / import / Copilot paths write `look` straight onto node data with
  // no validation (payload-builder passes `look: data.look` verbatim — the CLAUDE.md
  // pitfall 5b class). An unknown id here would throw AFTER a paid transcription and
  // fail the whole run, so an out-of-vocabulary look falls back to the default preset.
  const preset = CAPTION_LOOKS[look ?? DEFAULT_CAPTION_LOOK] ?? CAPTION_LOOKS[DEFAULT_CAPTION_LOOK]
  const out: CaptionLookLevers = { ...preset(fontSize) }
  for (const k of Object.keys(explicit) as (keyof CaptionLookLevers)[]) {
    if (explicit[k] !== undefined) (out[k] as CaptionLookLevers[typeof k]) = explicit[k]
  }
  return out
}

/**
 * Resolve the concrete render levers for a caption, applying the default look the
 * way each STYLE expects. A kinetic style — or a `subtitle` that NAMES a look —
 * resolves `look ?? outline` under the explicit overrides. A bare `subtitle` (no
 * look) stays PLAIN: only its explicit levers, NO preset — so a subtitle that
 * routes to Remotion never inherits the outline house-style unless asked (the old
 * FFmpeg drawtext path applied no look either). SINGLE SOURCE for the worker
 * top-level levers, the per-segment resolver, and the frontend config/preview
 * mirror, so "bare subtitle = plain" can't drift between them.
 */
export function resolveCaptionLevers(
  style: string | undefined | null,
  look: CaptionLookId | undefined,
  explicit: CaptionLookLevers,
  fontSize: number,
): CaptionLookLevers {
  if (!isKineticCaptionStyle(style) && look === undefined) return { ...explicit }
  return resolveCaptionLook(look, explicit, fontSize)
}
