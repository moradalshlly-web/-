import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { EmptyCanvasState } from "../empty-canvas-state"

const actions = {
  onCreate: vi.fn(), onOpenInputPanel: vi.fn(), onOpenMyLibrary: vi.fn(),
  onOpenMediaLibrary: vi.fn(), onOpenTutorials: vi.fn(),
}

describe("empty canvas optional templates", () => {
  it("keeps tutorials and creation available without a templates action", () => {
    render(<EmptyCanvasState {...actions} />)
    expect(screen.queryByRole("button", { name: "Templates" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tutorials" }))
    expect(actions.onOpenTutorials).toHaveBeenCalledOnce()
  })

  it("opens templates when the host supplies the action", () => {
    const onOpenTemplates = vi.fn()
    render(<EmptyCanvasState {...actions} onOpenTemplates={onOpenTemplates} />)
    fireEvent.click(screen.getByRole("button", { name: "Templates" }))
    expect(onOpenTemplates).toHaveBeenCalledOnce()
  })
})
