import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ComingSoonCard } from "../coming-soon-card"
import type { SocialProviderInfo } from "@/lib/api"

// Deferred read (call-time, not factory-time) so each describe can flip the
// edition without re-importing the component.
let cloudEdition = false
vi.mock("@/lib/edition", () => ({
  isCloud: () => cloudEdition,
}))

function provider(overrides: Partial<SocialProviderInfo> = {}): SocialProviderInfo {
  return {
    id: "reddit",
    label: "Reddit",
    connectKind: "oauth2",
    editor: "normal",
    category: "social",
    capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "none" },
    available: false,
    missingEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    ...overrides,
  } as SocialProviderInfo
}

/**
 * These assertions moved here from `platform-card.test.tsx` when the redesign
 * split unavailable networks into their own card. The behaviour they pin is
 * unchanged and still the point: the two editions mean different things by
 * "unavailable", and the card must not leak one edition's answer to the other.
 */
describe("ComingSoonCard (self-hosted — the reader owns the deployment)", () => {
  beforeEach(() => {
    cloudEdition = false
  })

  it("names the missing env vars, because here they are the setup guide", () => {
    render(<ComingSoonCard provider={provider()} />)
    expect(screen.getAllByText(/Requires setup/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET/)).toBeTruthy()
  })

  it("offers no way to connect — availability is decided by the server", () => {
    render(<ComingSoonCard provider={provider()} />)
    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull()
  })

  it("says Requires setup even when the deployment reported no env names", () => {
    render(<ComingSoonCard provider={provider({ missingEnv: undefined })} />)
    expect(screen.getAllByText(/Requires setup/i).length).toBeGreaterThan(0)
  })
})

describe("ComingSoonCard (cloud — the reader cannot set env vars)", () => {
  beforeEach(() => {
    cloudEdition = true
  })

  it("shows Coming soon and hides the deployment internals entirely", () => {
    render(<ComingSoonCard provider={provider()} />)
    // Cloud customers can't set env vars — the setup internals are noise to
    // them and must not render: not the env names, not "Requires setup".
    expect(screen.getAllByText(/Coming soon/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/REDDIT_CLIENT_ID/)).toBeNull()
    expect(screen.queryByText(/Requires setup/i)).toBeNull()
  })

  it("offers no way to connect", () => {
    render(<ComingSoonCard provider={provider()} />)
    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull()
  })
})
