import { useCallback, useEffect, useState } from "react"
import { useAppDir } from "@/lib/locale-store"

/** Quiet text action in a section header ("All use cases", "Join the community"). */
export const HOME_QUIET_LINK =
  "text-xs text-[var(--home-muted)] transition-colors hover:text-[var(--home-fg)] focus-visible:underline focus-visible:outline-none"

/** The design's outline button ("Browse docs"). */
export const HOME_OUTLINE_BUTTON =
  "inline-flex items-center whitespace-nowrap rounded-md border border-[var(--home-line)] px-3 py-[7px] text-xs font-semibold text-[var(--home-strong)] transition-colors hover:bg-[var(--home-raised)]"

const ROW_STEP_PX = 320

export interface RowScroller {
  readonly rowRef: (element: HTMLDivElement | null) => void
  readonly canBack: boolean
  readonly canForward: boolean
  readonly scrollBack: () => void
  readonly scrollForward: () => void
}

/**
 * A horizontal card row paged by the ‹ › buttons in its section header. In RTL
 * `scrollLeft` runs from 0 to negative, so the distance from the start edge is
 * its absolute value. `contentKey` re-measures when the items change without
 * the row itself resizing.
 */
export function useRowScroller(contentKey: string | number): RowScroller {
  const isRtl = useAppDir() === "rtl"
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ canBack: false, canForward: false })

  const measure = useCallback(() => {
    if (!row) return
    const scrolled = Math.abs(row.scrollLeft)
    const canBack = scrolled > 1
    const canForward = scrolled + row.clientWidth < row.scrollWidth - 1
    setEdges((prev) =>
      prev.canBack === canBack && prev.canForward === canForward ? prev : { canBack, canForward },
    )
  }, [row])

  useEffect(() => {
    if (!row) return
    const frame = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(row)
    row.addEventListener("scroll", measure, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      row.removeEventListener("scroll", measure)
    }
  }, [row, measure, contentKey])

  const scrollByStep = useCallback(
    (direction: 1 | -1) => {
      row?.scrollBy({ left: direction * (isRtl ? -1 : 1) * ROW_STEP_PX, behavior: "smooth" })
    },
    [row, isRtl],
  )

  return {
    rowRef: setRow,
    canBack: edges.canBack,
    canForward: edges.canForward,
    scrollBack: () => scrollByStep(-1),
    scrollForward: () => scrollByStep(1),
  }
}
