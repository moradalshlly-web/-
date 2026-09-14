import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** One line of the clamped text, in px — the prose and the plain paragraph both set 24px. */
const LINE_PX = 24

/**
 * Text clamped to a few lines with "Read more" when there is more — and only
 * then: the button appears when the content really overflows its box,
 * measured after layout and re-measured when the content changes (the
 * detail's write-up arrives after the card's one-liner). "Show less" folds
 * it back. `textKey` names the text; a new one starts folded.
 */
export function ReadMoreText({
  textKey,
  lines = 3,
  className,
  children,
}: {
  readonly textKey: string
  readonly lines?: number
  readonly className?: string
  readonly children: ReactNode
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [textKey])

  useLayoutEffect(() => {
    const box = boxRef.current
    const content = contentRef.current
    if (!box || !content || expanded) return
    const measure = () => setOverflows(content.scrollHeight > box.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [expanded, textKey])

  const folded = !expanded

  return (
    <div className={className}>
      <div
        ref={boxRef}
        className={cn(
          "relative overflow-hidden",
          folded &&
            overflows &&
            "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-[linear-gradient(to_bottom,transparent,var(--home-panel))] after:content-['']",
        )}
        style={folded ? { maxHeight: lines * LINE_PX } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-semibold text-[var(--primary)] hover:underline"
        >
          {expanded ? t("templates.readLess") : t("templates.readMore")}
        </button>
      )}
    </div>
  )
}
