import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchorStyle, captionLookStyle, captionWord } from "./caption-look"
import { activeCaptionLine, captionEnterFrame, captionLineCharBudget, groupCaptionLines } from "./caption-lines"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** ONE LINE at a time; each word of it springs vertically when it becomes active.
 *  The line grouping is `caption-lines`, shared with word-highlight, karaoke and
 *  the static subtitle — it used to render the ENTIRE transcript as one block,
 *  which on a 25 s clip is a wall of text and a bounce lost somewhere inside it.
 *  The line is HELD through pauses; a word's startMs only fires ITS bounce. */
export const BouncyOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, uppercase, positionY, animate,
  maxWordsPerLine,
}) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const ms = (frame / fps) * 1000
  // 700 mirrors the row's own hardcoded weight below, which is what renders
  // when the look pins no weight — so the budget is measured against the face
  // that actually paints.
  const lines = useMemo(
    () => groupCaptionLines(
      captions,
      captionLineCharBudget({ frameWidth: width, fontSize, fontFamily, fontWeight: fontWeight ?? 700, uppercase }),
      // splitToWidth: each word here is its own atomic `white-space: pre`
      // inline-block, so an ENTRY wider than the budget (a phrase-level
      // captions[] block) cannot wrap — it rendered as one box cut off at both
      // edges. Split it into sub-phrases that fit.
      { maxWords: maxWordsPerLine, splitToWidth: true },
    ),
    [captions, width, fontSize, fontFamily, fontWeight, uppercase, maxWordsPerLine],
  )
  const hit = activeCaptionLine(lines, ms)
  if (!hit) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...captionAnchorStyle(position, positionY), textAlign: "center",
      fontSize, color, fontWeight: 700, lineHeight: 1.2,
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // The WHOLE caption list (not just the visible line) drives the row's base
      // direction so word order follows the LANGUAGE of the piece, reordering
      // sibling word <span>s visually without touching DOM/timing order — see
      // the logoRowDirection pattern in blueprints/logo-assemble-lockup.tsx.
      // Structurally this overlay lays sibling word <span>s out the same way
      // karaoke/word-highlight do.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {hit.line.words.map((c, i) => {
        const localFrame = captionEnterFrame(c.startMs, frame, fps)
        // animate:false drops the per-word vertical bounce (dy stays 0). So does a
        // word whose startMs is not a usable number: `spring` throws on a NaN
        // frame, and although the `localFrame >= 0 && localFrame < fps` window
        // below already rejects a NaN on its own, the guard is stated here so
        // this overlay reads the same as the other two spring overlays (where
        // nothing else stands between a bad start and the throw).
        const bounce = animate === false || localFrame === null
          ? 1
          : localFrame >= 0 && localFrame < fps
            ? spring({ frame: localFrame, fps, config: { damping: 6, stiffness: 200 } })
            : 1
        const dy = (1 - bounce) * -20
        // The delimiter space sits OUTSIDE the word's box, as a text node of the row:
        // inside an inline-block that carries its own direction (a Hebrew word in a
        // Latin line, a brand name in a Hebrew one) the leading space lands on the
        // box's own start side — the wrong side in a mixed row, gluing the word to its
        // neighbour ("Nodaroזה"). In the row's bidi context a space between two atomic
        // boxes always falls between them, whichever way the row reads.
        return (
          <React.Fragment key={i}>
          {i > 0 ? " " : null}
          <span style={{
            display: "inline-block",
            whiteSpace: "pre",
            transform: `translateY(${dy}px)`,
            ...directionStyle(c.text),
          }}>
            {captionWord(c.text, 0)}
          </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}
