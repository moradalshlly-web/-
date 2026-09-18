import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchor, captionLookStyle, captionWord } from "./caption-look"
import { directionStyle } from "./text-direction"

export interface TikTokPagesOverlayProps extends OverlayCommonProps {
  combineTokensWithinMilliseconds?: number
}

/** TikTok-style 1-4 word pages via @remotion/captions::createTikTokStyleCaptions. */
export const TikTokPagesOverlay: React.FC<TikTokPagesOverlayProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY,
  combineTokensWithinMilliseconds = 1200,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const { pages } = useMemo(
    // createTikTokStyleCaptions only starts a NEW PAGE at a token that begins with
    // a space (the @remotion/captions word delimiter). Caller-supplied word-level
    // captions[] arrive as BARE words, so without this every word of a 25 s clip
    // collapsed into ONE page. Canonicalise the delimiter (and the order) first —
    // the same normalisation the row overlays get from captionWord at render.
    () => createTikTokStyleCaptions({
      captions: [...(captions as Caption[])]
        .sort((a, b) => a.startMs - b.startMs)
        .map((c, i) => ({ ...c, text: captionWord(c.text, i) })),
      combineTokensWithinMilliseconds,
    }),
    [captions, combineTokensWithinMilliseconds],
  )
  const active = pages.find((p) => ms >= p.startMs && ms <= p.startMs + p.durationMs)
  if (!active) return null
  const enterScale = spring({ frame: frame - (active.startMs / 1000) * fps, fps, config: { damping: 12, stiffness: 200 } })
  // With a highlightColor the page is rendered token by token and only the word
  // being spoken changes colour — the CapCut/TikTok read. Without one the page
  // stays a single pre-joined string, exactly as before.
  const spokenIdx = highlightColor
    ? active.tokens.reduce((hit, t, i) => (ms >= t.fromMs ? i : hit), -1)
    : -1
  const anchor = captionAnchor(position, positionY)
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...(anchor.top !== undefined ? { top: anchor.top } : {}),
      ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : {}),
      transform: `${anchor.translate} scale(${0.9 + enterScale * 0.1})`.trim(),
      textAlign: "center", fontSize, color, fontWeight: 800, lineHeight: 1.1,
      whiteSpace: "pre",
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.7em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // active.text is the pre-joined multi-word page string (no per-word
      // spans here), so it IS the "row container" and the "fullLineText" —
      // one directionStyle call covers both the row-direction and per-node
      // requirements from the RTL overlay contract.
      ...directionStyle(active.text),
    }}>
      {spokenIdx < 0 ? active.text : active.tokens.map((t, i) => (
        <span key={i} style={{
          // An inline-block starts its own line box, so CSS drops the leading
          // space that is the @remotion/captions word delimiter — pre keeps it.
          display: "inline-block", whiteSpace: "pre",
          color: i === spokenIdx ? highlightColor : color,
          ...directionStyle(t.text),
        }}>
          {captionWord(t.text, i)}
        </span>
      ))}
    </div>
  )
}
