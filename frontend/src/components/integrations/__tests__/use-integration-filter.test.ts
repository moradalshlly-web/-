import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { useIntegrationFilter, type IntegrationTab } from "../use-integration-filter"
import type { SocialProviderInfo } from "@/lib/api"
import type { SocialConnection } from "@/types/nodes"

function provider(over: Partial<SocialProviderInfo> & Pick<SocialProviderInfo, "id">): SocialProviderInfo {
  return {
    label: over.id,
    connectKind: "oauth2",
    editor: "normal",
    category: "social",
    capabilities: { schedule: true, comment: false, media: ["image"], refresh: "real" },
    available: true,
    ...over,
  } as SocialProviderInfo
}

function connection(platform: string, id = `${platform}-1`): SocialConnection {
  return { id, platform, display_name: platform } as SocialConnection
}

const PROVIDERS: SocialProviderInfo[] = [
  provider({ id: "instagram", label: "Instagram", category: "social" }),
  provider({ id: "telegram", label: "Telegram", category: "social" }),
  provider({ id: "wordpress", label: "WordPress", category: "publishing" }),
  provider({ id: "medium", label: "Medium", category: "publishing" }),
  provider({ id: "tiktok", label: "TikTok", category: "social", available: false }),
  provider({ id: "mastodon", label: "Mastodon", category: "social", available: false }),
]

const CONNECTIONS: SocialConnection[] = [connection("telegram"), connection("wordpress")]

function run(tab: IntegrationTab, query = "", providers = PROVIDERS, connections = CONNECTIONS) {
  return renderHook(() => useIntegrationFilter(providers, connections, tab, query)).result.current
}

describe("useIntegrationFilter", () => {
  it("splits connectable networks from ones this deployment cannot offer yet", () => {
    const r = run("all")
    expect(r.available.map((c) => c.provider.id)).toEqual(["telegram", "wordpress", "instagram", "medium"])
    expect(r.comingSoon.map((p) => p.id)).toEqual(["tiktok", "mastodon"])
  })

  it("puts connected networks first and keeps registry order inside each group", () => {
    expect(run("all").available.map((c) => c.provider.id)).toEqual([
      "telegram",
      "wordpress", // connected, in registry order
      "instagram",
      "medium", // the rest, in registry order
    ])
  })

  /**
   * The founding invariant of this page: a network appears because the server
   * said so. If this ever reads from a list in the frontend, a deployment that
   * configures a network keeps being told it is "coming soon".
   */
  it("derives coming-soon from availability, so configuring a network moves it", () => {
    const configured = PROVIDERS.map((p) => (p.id === "tiktok" ? { ...p, available: true } : p))
    const r = run("all", "", configured)
    expect(r.comingSoon.map((p) => p.id)).toEqual(["mastodon"])
    expect(r.available.map((c) => c.provider.id)).toContain("tiktok")
  })

  it("files tabs by the server's category, not by a name list", () => {
    expect(run("social").available.map((c) => c.provider.id)).toEqual(["telegram", "instagram"])
    expect(run("publishing").available.map((c) => c.provider.id)).toEqual(["wordpress", "medium"])
  })

  it("respects a category the server changes, with no frontend edit", () => {
    const moved = PROVIDERS.map((p) => (p.id === "medium" ? { ...p, category: "social" as const } : p))
    expect(run("social", "", moved).available.map((c) => c.provider.id)).toEqual([
      "telegram",
      "instagram",
      "medium",
    ])
  })

  it("Connected shows only networks with an account, and never coming-soon", () => {
    const r = run("connected")
    expect(r.available.map((c) => c.provider.id)).toEqual(["telegram", "wordpress"])
    expect(r.comingSoon).toEqual([])
  })

  it("searches the description as well as the name", () => {
    // "Toot with images" is Mastodon's description; its name doesn't contain "toot".
    expect(run("all", "toot").comingSoon.map((p) => p.id)).toEqual(["mastodon"])
  })

  it("search is case- and whitespace-insensitive", () => {
    expect(run("all", "  TELEGRAM ").available.map((c) => c.provider.id)).toEqual(["telegram"])
  })

  /**
   * The counters sit next to the heading, not next to the search box — they
   * answer "what does this deployment have", so a search must not move them.
   */
  it("counts the deployment, not the filtered view", () => {
    const all = run("all")
    const searched = run("all", "telegram")
    expect(searched.connectedCount).toBe(all.connectedCount)
    expect(searched.availableCount).toBe(all.availableCount)
    expect(all.connectedCount).toBe(2) // telegram, wordpress
    expect(all.availableCount).toBe(2) // instagram, medium — tiktok/mastodon are neither
  })

  it("reports empty only when nothing matched at all", () => {
    expect(run("all", "nothing-matches-this").isEmpty).toBe(true)
    expect(run("all", "telegram").isEmpty).toBe(false)
  })
})
