/**
 * The Web Scrape PANEL offers only the sources this viewer may use.
 *
 * `web-scrape-source-options.test.tsx` pins the rule; this pins that the panel
 * actually renders through it — reverting the dropdown to a plain map over the
 * source list would otherwise pass every other test while putting a withdrawn
 * source (Instagram, when the Instagram node is withheld) back in front of users.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { WebScrapeNodeData } from "@/types/nodes"

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}))
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => <input {...props} /> }))
vi.mock("../mappable-field", () => ({
  MappableField: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
}))
// A flat stand-in for Radix Select: every SelectItem becomes an <option>, wherever it is rendered from.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value }: { children: React.ReactNode; value?: string }) => <div data-select-value={value}>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div role="option" aria-selected={false} data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <span data-id={id}>{children}</span>,
  SelectValue: () => null,
}))

// The panel prices its crawl modes through the credits hook, which reads React
// Query. Prices are not under test here — the hook answers its fallback.
vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: (_id: string | undefined, fallback = 0) => fallback,
}))
import { WebScrapeConfig } from "../scraper-configs"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"

function renderPanel(data: Partial<WebScrapeNodeData>) {
  return render(
    <WebScrapeConfig
      data={{ label: "Web Scrape", actor: "google-search", ...data } as WebScrapeNodeData}
      onUpdate={vi.fn()}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
}

/** The source dropdown's options (the panel has other selects; sources are the known actor ids). */
const SOURCE_IDS = new Set(["google-search", "content-crawler", "instagram", "tiktok", "rss"])
const offeredSources = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.getAttribute("data-value") ?? "")
    .filter((v) => SOURCE_IDS.has(v))

beforeEach(() => __resetSurfaceAvailabilityForTests(null))

describe("WebScrapeConfig — the source dropdown follows availability", () => {
  it("offers Instagram while nothing is withdrawn", () => {
    renderPanel({})
    expect(offeredSources()).toContain("instagram")
  })

  it("does not offer Instagram to a user once the Instagram node is withheld", () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["instagram-scrape"], models: [], webScrapeSources: { denied: ["instagram"] } })
    renderPanel({})
    expect(offeredSources()).not.toContain("instagram")
    expect(offeredSources()).toContain("tiktok")
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("a node already on Instagram keeps showing it and says the run will be refused", () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["instagram-scrape"], models: [], webScrapeSources: { denied: ["instagram"] } })
    renderPanel({ actor: "instagram" })
    expect(offeredSources()).toContain("instagram")
    expect(screen.getByRole("status").textContent).toMatch(/not available on this deployment/i)
  })

  it("offers it to an admin, marked", () => {
    __resetSurfaceAvailabilityForTests({
      nodes: [],
      models: [],
      hiddenFromUsers: ["instagram-scrape"],
      webScrapeSources: { denied: [], hiddenFromUsers: ["instagram"] },
    })
    renderPanel({})
    const ig = screen.getAllByRole("option").find((o) => o.getAttribute("data-value") === "instagram")
    expect(ig?.textContent).toContain("ADMIN")
    expect(screen.queryByRole("status")).toBeNull()
  })
})
