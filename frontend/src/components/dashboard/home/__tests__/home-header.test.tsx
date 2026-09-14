import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { HomeHeader, type HomeHeaderProps } from "../home-header"

function renderHeader(overrides: Partial<HomeHeaderProps> = {}) {
  const props: HomeHeaderProps = {
    greeting: "Good afternoon, asaf",
    activeTab: "continue",
    exploreVisible: true,
    onSelectTab: vi.fn(),
    onNewWorkflow: vi.fn(),
    isCreating: false,
    ...overrides,
  }
  render(<HomeHeader {...props} />)
  return props
}

describe("HomeHeader", () => {
  it("renders the greeting as the page heading", () => {
    renderHeader()
    expect(screen.getByRole("heading", { level: 1, name: "Good afternoon, asaf" })).toBeInTheDocument()
  })

  it("shows Continue and Explore as tabs, with the active one selected", () => {
    renderHeader({ activeTab: "explore" })
    expect(screen.getByRole("tab", { name: /Continue/ })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: /Explore/ })).toHaveAttribute("aria-selected", "true")
  })

  it("reports a click on the other tab", () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole("tab", { name: /Explore/ }))
    expect(props.onSelectTab).toHaveBeenCalledWith("explore")
  })

  it("moves between tabs with the arrow keys", () => {
    const props = renderHeader()
    fireEvent.keyDown(screen.getByRole("tab", { name: /Continue/ }), { key: "ArrowRight" })
    expect(props.onSelectTab).toHaveBeenCalledWith("explore")
  })

  it("keeps only the selected tab in the tab order", () => {
    renderHeader()
    expect(screen.getByRole("tab", { name: /Continue/ })).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("tab", { name: /Explore/ })).toHaveAttribute("tabindex", "-1")
  })

  it("hides the Explore tab when the profile leaves it nothing to show", () => {
    renderHeader({ exploreVisible: false })
    expect(screen.getAllByRole("tab")).toHaveLength(1)
    expect(screen.queryByRole("tab", { name: /Explore/ })).not.toBeInTheDocument()
  })

  it("creates a workflow from the New Workflow button", () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole("button", { name: "New Workflow" }))
    expect(props.onNewWorkflow).toHaveBeenCalledTimes(1)
  })

  it("disables the button while a workflow is being created", () => {
    renderHeader({ isCreating: true })
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled()
  })
})
