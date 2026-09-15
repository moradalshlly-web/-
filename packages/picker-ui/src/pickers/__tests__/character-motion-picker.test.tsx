import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { CHARACTER_MOTION_CATEGORY_LABELS, CHARACTER_MOTION_CATEGORY_ORDER } from "@nodaro/prompts"
import { CharacterMotionPicker } from "../character-motion-picker"

// Four moves from the first tab (Entrances & Exits), so no tab switching.
const A = { id: "walk-in-from-left", name: /Walk In From Left/i }
const B = { id: "walk-in-from-right", name: /Walk In From Right/i }
const C = { id: "enter-from-behind-camera", name: /Enter From Behind Camera/i }
const D = { id: "approach-from-background", name: /Approach From Background/i }

describe("CharacterMotionPicker", () => {
  it("renders one tab per category, in catalog order", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(CHARACTER_MOTION_CATEGORY_ORDER.map((c) => CHARACTER_MOTION_CATEGORY_LABELS[c]))
  })

  it("defaults to three ordered picks", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    expect(screen.getByText(/0\s*\/\s*3 selected/)).toBeInTheDocument()
  })

  it("a first click emits the id string", () => {
    const onChange = vi.fn()
    render(<CharacterMotionPicker value={undefined} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: A.name }))
    expect(onChange).toHaveBeenLastCalledWith(A.id)
  })

  it("appends picks in click order and shows the numbered sequence", () => {
    const onChange = vi.fn()
    const { rerender } = render(<CharacterMotionPicker value={[A.id]} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: B.name }))
    expect(onChange).toHaveBeenLastCalledWith([A.id, B.id])

    rerender(<CharacterMotionPicker value={[B.id, A.id]} onValueChange={onChange} />)
    const steps = within(screen.getByRole("list", { name: "Motion sequence" })).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual(["1Walk In From Right", "2Walk In From Left"])
  })

  it("at the cap a new pick drops the OLDEST (first-in, first-out)", () => {
    const onChange = vi.fn()
    render(<CharacterMotionPicker value={[A.id, B.id, C.id]} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: D.name }))
    expect(onChange).toHaveBeenLastCalledWith([B.id, C.id, D.id])
  })

  it("search flattens across categories and hides the tabs", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "wave hello" } })
    expect(screen.getByRole("checkbox", { name: /Wave Hello/i })).toBeInTheDocument()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })

  it("shows an empty state when nothing matches", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "xyzqq" } })
    expect(screen.getByText(/No moves match/)).toBeInTheDocument()
  })
})
