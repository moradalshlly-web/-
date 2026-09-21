import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { AppSidebar } from "../app-sidebar"
import { SidebarProvider } from "../sidebar-context"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, isAdmin: false, signOut: vi.fn() }) }))
vi.mock("@/hooks/queries/use-gallery-queries", () => ({ useGalleryReportCount: () => ({ data: 0 }) }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ useUserCredits: () => ({ data: null }) }))
vi.mock("@/ee/hooks/queries/use-deployment-billing", () => ({ useDeploymentPayerViewer: () => ({ isPayer: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: {} }) }))
vi.mock("@/hooks/use-update-check", () => ({ useUpdateCheck: () => null }))

afterEach(() => { delete window.__NODARO_RUNTIME__ })

describe("deployment app menu", () => {
  it.each([false, true])("uses the configured brand and siblings (collapsed=%s)", async (collapsed) => {
    window.__NODARO_RUNTIME__ = { surface: {
      brand: { productName: "Acme Studio", platformLinks: false },
      siblings: { apps: [{ label: "Acme Chat", url: "https://chat.example" }] },
      nav: { hide: ["templates"] },
    } }
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SidebarProvider defaultCollapsed={collapsed}><AppSidebar /></SidebarProvider></MemoryRouter></QueryClientProvider>)
    const trigger = screen.getByRole("button", { name: "Open menu" })
    expect(trigger).toHaveAttribute("title", "Acme Studio")
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByText("Acme Studio")).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: /Acme Chat/ })).toHaveAttribute("href", "https://chat.example")
    expect(menu.textContent).not.toMatch(/nodaro/i)
    expect(menu.querySelectorAll('a[href*="nodaro"]')).toHaveLength(0)
    expect(document.querySelector('a[href="/templates"]')).toBeNull()
  })
})
