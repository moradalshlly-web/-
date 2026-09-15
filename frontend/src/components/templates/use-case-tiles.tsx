import { ArrowRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { PreviewVideo } from "@/components/ui/preview-video"
import { RowArrows, SectionTitle, SkeletonRow } from "@/components/dashboard/home/home-section"
import { useRowScroller } from "@/components/dashboard/home/home-ui"
import type { UseCaseTile } from "@/components/dashboard/home/template-use-cases"
import { templateCategoryLabel } from "@/lib/template-categories"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

/**
 * "Use cases" on the Templates page: one 240px 16:9 tile per category (the
 * reference measures 241×133), the active one ringed in the accent. A tile
 * toggles the grid's category filter; the row itself never changes with the
 * filter, so the other use cases stay a click away.
 */
const TILE_WIDTH = 240
export function UseCaseTiles({
  tiles,
  active,
  isLoading,
  onToggle,
}: {
  readonly tiles: readonly UseCaseTile[]
  readonly active: string | undefined
  readonly isLoading: boolean
  readonly onToggle: (category: string) => void
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const scroller = useRowScroller(tiles.length)

  if (!isLoading && tiles.length === 0) return null

  return (
    <section>
      <SectionTitle title={t("templates.useCases")} trailing={tiles.length > 0 ? <RowArrows scroller={scroller} /> : undefined} />
      {isLoading ? (
        <SkeletonRow itemWidth={TILE_WIDTH} aspectClass="aspect-video" />
      ) : (
        <div ref={scroller.rowRef} role="group" aria-label={t("templates.useCases")} className="home-row-scroll mt-3 flex gap-3 overflow-x-auto pb-1.5">
          {tiles.map((tile) => {
            const selected = tile.category === active
            return (
              <button
                key={tile.category}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(tile.category)}
                className={cn(
                  "home-stripes relative aspect-video w-[240px] flex-none overflow-hidden rounded-xl text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--home-bg)]",
                  selected ? "border-2 border-[var(--primary)]" : "border border-[var(--home-line-2)] hover:border-[var(--home-muted)]",
                )}
              >
                {tile.coverUrl &&
                  (tile.coverType === "video" ? (
                    <PreviewVideo src={tile.coverUrl} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <CachedImage src={tile.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" thumbnail />
                  ))}
                <span className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgba(0,0,0,0.6))]" aria-hidden />
                <span className="absolute bottom-2.5 start-3 flex items-center gap-1 text-[13px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
                  {templateCategoryLabel(tile.category, t)}
                  <ArrowRight className={cn("size-3.5", isRtl && "rotate-180")} aria-hidden />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
