import { describe, it, expect, afterEach } from "vitest"
import { NAV_ITEMS, isNavItemSurfaceHidden } from "../app-sidebar"

/**
 * The Templates, Tutorials and MiniApps sidebar entries are doorways to home
 * screen sections that `dashboard.tabs` governs. Before the home redesign the
 * first and last were code-hidden and the tutorials one was ungated, so a
 * deployment that narrowed the discovery strip had no path to those pages.
 * The entries must follow the same whitelist, or an upgrade silently widens
 * such a deployment's surface — and an un-gated Tutorials entry would lead
 * to a tab the page then strips away, a dead item.
 */
afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

const byLabel = (label: string) => {
  const item = NAV_ITEMS.find((i) => i.label === label)
  if (!item) throw new Error(`no nav item labelled ${label}`)
  return item
}

describe("sidebar entries that follow dashboard.tabs", () => {
  it("names the section key on exactly the three doorway entries", () => {
    expect(byLabel("nav.templates").dashboardKey).toBe("templates")
    expect(byLabel("nav.tutorials").dashboardKey).toBe("tutorials")
    expect(byLabel("nav.miniapps").dashboardKey).toBe("miniapps")
    expect(NAV_ITEMS.filter((i) => i.dashboardKey !== undefined)).toHaveLength(3)
  })

  it("shows all three on the stock profile", () => {
    for (const label of ["nav.templates", "nav.tutorials", "nav.miniapps"]) {
      expect(isNavItemSurfaceHidden(byLabel(label)), label).toBe(false)
    }
  })

  it("hides an entry whose key a whitelist leaves out, and keeps one it names", () => {
    window.__NODARO_RUNTIME__ = { surface: { dashboard: { tabs: ["workflows", "projects", "statistics", "tutorials"] } } }
    expect(isNavItemSurfaceHidden(byLabel("nav.templates"))).toBe(true)
    expect(isNavItemSurfaceHidden(byLabel("nav.miniapps"))).toBe(true)
    expect(isNavItemSurfaceHidden(byLabel("nav.tutorials"))).toBe(false)
    // An entry without a key is untouched by the whitelist.
    expect(isNavItemSurfaceHidden(byLabel("nav.projects"))).toBe(false)
  })

  it("still honours nav.hide on top of the whitelist", () => {
    window.__NODARO_RUNTIME__ = { surface: { nav: { hide: ["templates"] } } }
    expect(isNavItemSurfaceHidden(byLabel("nav.templates"))).toBe(true)
    expect(isNavItemSurfaceHidden(byLabel("nav.miniapps"))).toBe(false)
  })
})
