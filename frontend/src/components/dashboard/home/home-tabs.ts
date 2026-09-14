import type { DashboardTabKey } from "@/lib/surface-profile"

/**
 * The home (Projects) screen's two header tabs, from the "Notched Header Tabs"
 * design handoff. They replace the old app-discovery strip
 * (Apps / MiniApps / Templates / Tutorials / Statistics).
 *
 * The deployment contract did NOT change with the layout: `dashboard.tabs`
 * still whitelists the same keys (docs/deployment.md), and each key now gates
 * the section that inherited its content — plus, for the three that got a
 * sidebar entry, that entry (app-sidebar.tsx `dashboardKey`):
 *   apps       → the "Nodaro apps" band on Continue
 *   templates  → "Start from a template" on Explore + the Templates entry
 *   tutorials  → "Level up" on Explore + the Tutorials entry
 *   miniapps   → the MiniApps entry (nothing on this page)
 *   statistics → the stats overview on /executions
 */
export type HomeTab = "continue" | "explore"

export const HOME_TABS: readonly HomeTab[] = ["continue", "explore"]

/** The panel both header tabs control — one region whose content swaps with the tab. */
export const HOME_PANEL_ID = "home-panel"

export function homeTabId(tab: HomeTab): string {
  return `home-tab-${tab}`
}

/** The profile keys whose sections live on Explore. None visible → no Explore tab. */
export const EXPLORE_SECTION_KEYS = ["templates", "tutorials"] as const satisfies readonly DashboardTabKey[]

/** The profile key that gates the Nodaro apps band on Continue. */
export const NODARO_APPS_KEY = "apps" as const satisfies DashboardTabKey

/** The profile key that gates the stats overview on /executions. */
export const STATISTICS_KEY = "statistics" as const satisfies DashboardTabKey

/** The profile key that gates the MiniApps sidebar entry (and the legacy ?tab=miniapps hop). */
export const MINIAPPS_KEY = "miniapps" as const satisfies DashboardTabKey

export interface HomeTabVisibility {
  /** At least one Explore section survives the surface profile. */
  readonly exploreVisible: boolean
  /** The MiniApps page is reachable (its nav entry is not hidden). */
  readonly appsPageVisible: boolean
  /** The stats overview renders on /executions. */
  readonly statisticsVisible: boolean
}

export interface HomeTabResolution {
  readonly tab: HomeTab
  /**
   * Present only when the URL should be rewritten in place: a string is the
   * canonical `tab` value, `null` removes the param. Absent = leave the URL.
   */
  readonly canonicalParam?: string | null
  /** Present when the requested view moved off this page. */
  readonly redirectTo?: string
}

const CONTINUE_CANONICAL: HomeTabResolution = { tab: "continue", canonicalParam: null }

/**
 * Which tab a `?tab=` value opens. The URL is the single source of truth (a
 * sidebar link, the back button and a pasted link must all agree), so this is
 * derived on every render rather than seeded into state.
 *
 * Old links keep working: the discovery-strip values that moved onto Explore
 * are rewritten to `explore`, the two views that left the page redirect to
 * their new home, and the workspace values (`workflows`/`projects`/`studio`)
 * stay in the URL because the Jump back in filter still reads them.
 */
export function resolveHomeTab(requested: string | null, visibility: HomeTabVisibility): HomeTabResolution {
  switch (requested) {
    case "explore":
      return visibility.exploreVisible ? { tab: "explore" } : CONTINUE_CANONICAL
    case "tutorials":
    case "templates":
      return visibility.exploreVisible ? { tab: "explore", canonicalParam: "explore" } : CONTINUE_CANONICAL
    case "continue":
    case "apps":
      return CONTINUE_CANONICAL
    case "miniapps":
      return visibility.appsPageVisible ? { tab: "continue", redirectTo: "/apps" } : CONTINUE_CANONICAL
    case "statistics":
      return visibility.statisticsVisible ? { tab: "continue", redirectTo: "/executions" } : CONTINUE_CANONICAL
    default:
      return { tab: "continue" }
  }
}
