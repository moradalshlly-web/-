import { describe, it, expect } from "vitest"
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { useCallback } from "react"
import { useDismissableLayerSurface } from "@radix-ui/react-dismissable-layer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Why this exists (2026-09-16, "model picker doesn't close when clicking
 * outside"): Radix Popover ≥1.1.23 DEFERS outside-pointerdown dismissal to
 * the follow-up `click`, and skips it when an intermediate handler stopped one
 * of the interaction events from bubbling back to the document — it reads that
 * as "someone else owns this interaction". React Flow's d3-zoom calls
 * stopImmediatePropagation on the pane's `mousedown`, so every non-modal
 * popover over the canvas ignored pane clicks (Escape still worked).
 *
 * The fix registers the canvas wrapper as a Radix dismissable SURFACE, whose
 * interactions count as outside even when stopped. The first two cases pin the
 * mechanism against the installed Radix (a future Radix that changes the
 * semantics or drops the export fails here, not in production); the third
 * pins the wiring in workflow-canvas.tsx.
 */

/** A "pane" whose native mousedown listener behaves like d3-zoom. */
function useD3LikePane() {
  return useCallback((el: HTMLDivElement | null) => {
    if (el) el.addEventListener("mousedown", (e) => e.stopImmediatePropagation())
  }, [])
}

function Fixture({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger>open</PopoverTrigger>
      <PopoverContent>popover body</PopoverContent>
      {children}
    </Popover>
  )
}

function PlainPane() {
  const paneRef = useD3LikePane()
  return <div ref={paneRef} data-testid="pane" style={{ width: 400, height: 400 }} />
}

function SurfacePane() {
  const surfaceRef = useDismissableLayerSurface()
  const paneRef = useD3LikePane()
  return (
    <div ref={surfaceRef}>
      <div ref={paneRef} data-testid="pane" style={{ width: 400, height: 400 }} />
    </div>
  )
}

/** pointerdown → mousedown (stopped at the pane) → mouseup → click, like a real
 *  mouse click on the React Flow pane. */
function clickPane() {
  const pane = screen.getByTestId("pane")
  fireEvent.pointerDown(pane, { button: 0, pointerType: "mouse" })
  fireEvent.mouseDown(pane, { button: 0 })
  fireEvent.mouseUp(pane, { button: 0 })
  fireEvent.click(pane, { button: 0 })
}

async function openPopover() {
  await userEvent.click(screen.getByText("open"))
  expect(await screen.findByText("popover body")).toBeInTheDocument()
  // Radix attaches its document pointerdown listener in a setTimeout(0).
  await act(() => new Promise((r) => setTimeout(r, 20)))
}

describe("canvas dismissable surface", () => {
  it("control: without a surface, a click on a mousedown-stopping pane leaves the popover open", async () => {
    render(
      <Fixture>
        <PlainPane />
      </Fixture>,
    )
    await openPopover()
    clickPane()
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(screen.queryByText("popover body")).toBeInTheDocument()
  })

  it("with the pane registered as a surface, the same click dismisses the popover", async () => {
    render(
      <Fixture>
        <SurfacePane />
      </Fixture>,
    )
    await openPopover()
    clickPane()
    await waitFor(() => expect(screen.queryByText("popover body")).toBeNull())
  })

  it("workflow-canvas registers the React Flow wrapper as the surface", () => {
    const src = readFileSync(resolve(__dirname, "../workflow-canvas.tsx"), "utf8")
    expect(src).toContain('import { useDismissableLayerSurface } from "@radix-ui/react-dismissable-layer"')
    expect(src).toContain("const dismissableSurfaceRef = useDismissableLayerSurface()")
    expect(src).toMatch(/<div ref=\{dismissableSurfaceRef\}[^\n]*>\s*\n[\s\S]{0,400}<ReactFlow\b/)
  })
})
