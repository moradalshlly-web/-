import type { TemplateBrowseCard } from "@/lib/api"
import type { TemplateSort } from "@/lib/template-utils"

/**
 * "Start from a template" on the Explore tab: one tile per template category
 * (a use case), covered by the best-ranked template in it that has media.
 */
export type TemplateFilter = "for-you" | "trending" | "new-this-week"

export const TEMPLATE_FILTERS: readonly TemplateFilter[] = ["for-you", "trending", "new-this-week"]

export const TEMPLATE_FILTER_SORT: Readonly<Record<TemplateFilter, TemplateSort>> = {
  "for-you": "most-favorited",
  trending: "popular",
  "new-this-week": "newest",
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface UseCaseTile {
  readonly category: string
  readonly coverUrl: string | null
  readonly coverType: string | null
  readonly count: number
}

type TileSource = Pick<TemplateBrowseCard, "id" | "category" | "previewMediaUrl" | "previewMediaType" | "createdAt">

type TileCover = Pick<UseCaseTile, "coverUrl" | "coverType">

interface RankedTile extends UseCaseTile {
  /** Position of the category's best template in the ranked list. */
  readonly rank: number
}

interface TileOptions {
  readonly filter: TemplateFilter
  readonly now: number
  /** The user's own favorited template ids — what makes "For you" theirs. */
  readonly favoriteIds?: readonly string[]
  /**
   * Every category gets a tile, in the order given, empty ones with no cover
   * — the Templates page shows the whole taxonomy. Off, only categories that
   * hold a template appear, ordered by their best template (the home row).
   */
  readonly all?: boolean
}

function coverOf(template: TileSource): TileCover {
  return template.previewMediaUrl
    ? { coverUrl: template.previewMediaUrl, coverType: template.previewMediaType ?? null }
    : { coverUrl: null, coverType: null }
}

/**
 * Tiles ordered by each category's best-ranked template, so the filter that
 * picked the sort shows in the row (a category whose top template is #1 under
 * Trending leads it). Under "For you" the user's own favorites rank first;
 * behind them the API's most-favorited order fills in. A category with no
 * template gets no tile, so a tile never opens an empty list, and the first
 * template with media becomes the cover.
 */
export function buildUseCaseTiles(
  categories: readonly string[],
  templates: readonly TileSource[],
  options: TileOptions,
): UseCaseTile[] {
  const pool =
    options.filter === "new-this-week"
      ? templates.filter((t) => options.now - Date.parse(t.createdAt) <= NEW_WINDOW_MS)
      : templates
  const favorites = new Set(options.filter === "for-you" ? options.favoriteIds ?? [] : [])
  const ranked = favorites.size
    ? [...pool.filter((t) => favorites.has(t.id)), ...pool.filter((t) => !favorites.has(t.id))]
    : pool
  const known = new Set(categories)

  const tiles = ranked.reduce<ReadonlyMap<string, RankedTile>>((acc, template, rank) => {
    if (!known.has(template.category)) return acc
    const existing = acc.get(template.category)
    const next: RankedTile = existing
      ? { ...existing, count: existing.count + 1, ...(existing.coverUrl ? {} : coverOf(template)) }
      : { category: template.category, ...coverOf(template), count: 1, rank }
    return new Map(acc).set(template.category, next)
  }, new Map())

  const strip = (tile: UseCaseTile): UseCaseTile => ({
    category: tile.category,
    coverUrl: tile.coverUrl,
    coverType: tile.coverType,
    count: tile.count,
  })
  if (options.all) {
    return categories.map((category) => strip(tiles.get(category) ?? { category, coverUrl: null, coverType: null, count: 0 }))
  }
  return [...tiles.values()].sort((a, b) => a.rank - b.rank).map(strip)
}

/** The templates page, pre-filtered to the tile's category and the row's sort. */
export function templatesPageHref(category: string, filter: TemplateFilter): string {
  const params = new URLSearchParams({ category, sort: TEMPLATE_FILTER_SORT[filter] })
  return `/templates?${params.toString()}`
}
