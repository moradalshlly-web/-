import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionRowColors, captionWord } from "./caption-look"
import { activeCaptionLine, captionLineCharBudget, captionWindowSweeps, groupCaptionLines } from "./caption-lines"
import { directionStyle, resolveDirection, rowDirectionFromCaptions } from "./text-direction"

/** ONE LINE at a time; each word of it wipes from the rest colour to the spoken
 *  colour over its [startMs, endMs] window. Colours come from `captionRowColors`
 *  (spoken = highlightColor ?? color; rest = color, dimmed when no highlight).
 *
 *  The line grouping is `caption-lines`, shared with word-highlight and the
 *  static subtitle: it used to render the ENTIRE transcript as one block, which
 *  on a 25 s clip is a wall of text filling the frame and a sweep nobody can
 *  follow. The line is HELD through pauses — a word's window drives the WIPE,
 *  never whether text is on screen.
 *
 *  The wipe is TWO stacked SOLID-fill spans (rest underneath, spoken on top
 *  clipped to the progress edge) — NOT a background-clip gradient. Both layers
 *  inherit the look's `-webkit-text-stroke` + `paint-order` from the container,
 *  so the outline reads correctly; a transparent-fill gradient let the stroke's
 *  inner half bleed over the glyph (it has no solid fill to paint behind). */
export const KaraokeOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, animate,
  maxWordsPerLine,
}) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const { spoken, rest } = captionRowColors(color, highlightColor)
  // 700 mirrors the row's own hardcoded weight below, which is what renders
  // when the look pins no weight — so the budget is measured against the face
  // that actually paints.
  const lines = useMemo(
    () => groupCaptionLines(
      captions,
      captionLineCharBudget({ frameWidth: width, fontSize, fontFamily, fontWeight: fontWeight ?? 700, uppercase }),
      { maxWords: maxWordsPerLine },
    ),
    [captions, width, fontSize, fontFamily, fontWeight, uppercase, maxWordsPerLine],
  )
  const hit = activeCaptionLine(lines, ms)
  if (!hit) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      fontSize, color: rest, fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // The WHOLE caption list (not just the visible line) drives the row's base
      // direction, so word order follows the LANGUAGE of the piece: a Hebrew /
      // Arabic line that happens to open with a Latin token (a brand name) must
      // still lay out RTL — detecting per line flipped it to LTR and reversed
      // its word order. Reorders sibling word <span>s visually without touching
      // DOM/timing order — see the logoRowDirection pattern in
      // blueprints/logo-assemble-lockup.tsx.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {hit.line.words.map((c, i) => {
        // animate:false replaces the intra-word sweep with a discrete per-word
        // fill (spoken once the word starts) — no per-frame motion. A word whose
        // window CANNOT sweep (zero-length or inverted — `interpolate` throws on
        // it and would fail the whole render) takes that same discrete fill: it
        // is the only correct render for a window with no duration to sweep over.
        const t = animate === false || !captionWindowSweeps(c)
          ? (ms >= c.startMs ? 1 : 0)
          : interpolate(ms, [c.startMs, c.endMs], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        const hidden = (1 - t) * 100
        // Reveal from the reading edge: LTR clips the RIGHT away, RTL the LEFT.
        const dir = resolveDirection(c.text)
        const clip = dir === "rtl" ? `inset(0 0 0 ${hidden}%)` : `inset(0 ${hidden}% 0 0)`
        const word = captionWord(c.text, 0)
        return (
          // Base (rest colour) with the spoken clone stacked exactly on top; both
          // solid fills, both inherit the stroke, so the clone's clipped stroke
          // sits over the base's identical stroke — no seam at the wipe edge.
          // The delimiter space sits OUTSIDE the word's box, as a text node of the row:
          // inside an inline-block that carries its own direction (a Hebrew word in a
          // Latin line, a brand name in a Hebrew one) the leading space lands on the
          // box's own start side — the wrong side in a mixed row, gluing the word to its
          // neighbour ("Nodaroזה"). In the row's bidi context a space between two atomic
          // boxes always falls between them, whichever way the row reads.
          <React.Fragment key={i}>
          {i > 0 ? " " : null}
          <span style={{ display: "inline-block", position: "relative", whiteSpace: "pre", color: rest, ...directionStyle(c.text) }}>
            {word}
            <span aria-hidden style={{
              position: "absolute", inset: 0, whiteSpace: "pre", color: spoken,
              pointerEvents: "none", clipPath: clip,
              ...directionStyle(c.text),
            }}>
              {word}
            </span>
          </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}
