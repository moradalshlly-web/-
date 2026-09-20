/**
 * "Clear results" lives on the canvas tool bar, directly beside Undo — the
 * button that takes it back. It is offered only on a canvas that can be
 * edited, and it dims (rather than disappears) when there is nothing to clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"

vi.mock("@/components/layout/sidebar-context", () => ({
  useSidebar: () => ({ sidebarWidth: 64, isCollapsed: true, setCollapsed: vi.fn(), toggleCollapsed: vi.fn() }),
}))
vi.mock("@/hooks/use-is-mobile", () => ({ useIsMobile: () => false }))

const { CanvasToolbar } = await import("../canvas-toolbar")

const Router = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

const base = {
  onAddNode: vi.fn(),
  onComponents: vi.fn(),
  onSearch: vi.fn(),
  onFindInWorkflow: vi.fn(),
  onPreviousFocus: vi.fn(),
  onAssetLibrary: vi.fn(),
  onMediaLibrary: vi.fn(),
  onAddStickyNote: vi.fn(),
  onTidyUp: vi.fn(),
  onToggleSidebar: vi.fn(),
  sidebarVisible: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: true,
  canRedo: false,
  onShowShortcuts: vi.fn(),
}

/** Both bars render (CSS picks one), so every button exists twice. */
const buttons = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => act(() => useLocaleStore.getState().setLocale("en")))

describe("canvas toolbar — Clear results", () => {
  it("is not offered when the canvas gives it no handler (read-only)", () => {
    const { container } = render(<CanvasToolbar {...base} />, { wrapper: Router })
    expect(buttons(container, "Clear all results")).toHaveLength(0)
  })

  it("runs the handler once per click, on the desktop bar and on the mobile bar", () => {
    const onClearResults = vi.fn()
    const { container } = render(<CanvasToolbar {...base} onClearResults={onClearResults} canClearResults />, { wrapper: Router })
    const found = buttons(container, "Clear all results")
    expect(found).toHaveLength(2)
    for (const button of found) fireEvent.click(button)
    expect(onClearResults).toHaveBeenCalledTimes(2)
  })

  it("dims and ignores clicks while there is nothing to clear", () => {
    const onClearResults = vi.fn()
    const { container } = render(<CanvasToolbar {...base} onClearResults={onClearResults} canClearResults={false} />, { wrapper: Router })
    for (const button of buttons(container, "Clear all results")) {
      expect(button.getAttribute("aria-disabled")).toBe("true")
      fireEvent.click(button)
    }
    expect(onClearResults).not.toHaveBeenCalled()
  })

  it("is not announced as disabled when it can be used", () => {
    const { container } = render(<CanvasToolbar {...base} onClearResults={vi.fn()} canClearResults />, { wrapper: Router })
    for (const button of buttons(container, "Clear all results")) expect(button.hasAttribute("aria-disabled")).toBe(false)
  })

  it("is dimmed unless the canvas SAYS there is something to clear", () => {
    const onClearResults = vi.fn()
    const { container } = render(<CanvasToolbar {...base} onClearResults={onClearResults} />, { wrapper: Router })
    for (const button of buttons(container, "Clear all results")) fireEvent.click(button)
    expect(onClearResults).not.toHaveBeenCalled()
  })

  it("sits immediately before Undo on both bars", () => {
    const { container } = render(<CanvasToolbar {...base} onClearResults={vi.fn()} canClearResults />, { wrapper: Router })
    const all = [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
    const clears = buttons(container, "Clear all results")
    expect(clears).toHaveLength(2)
    for (const clear of clears) {
      expect(all[all.indexOf(clear) + 1]?.getAttribute("aria-label")).toBe("Undo")
    }
  })

  it("is named in Hebrew under the Hebrew locale", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    const { container } = render(<CanvasToolbar {...base} onClearResults={vi.fn()} canClearResults />, { wrapper: Router })
    expect(buttons(container, "ניקוי כל התוצאות")).toHaveLength(2)
  })
})
