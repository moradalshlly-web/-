/**
 * The picker mark for a node the admin switch hides from users. An admin still
 * sees and runs such a node; the mark is what tells them their users do not —
 * so it must appear for exactly the types the backend names, arrive late (the
 * availability fetch lands after first paint), and never render otherwise.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { render, act } from "@testing-library/react"
import { HiddenFromUsersMark } from "../hidden-from-users-mark"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"

beforeEach(() => __resetSurfaceAvailabilityForTests(null))

describe("HiddenFromUsersMark", () => {
  it("renders nothing for a node that is not hidden", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], hiddenFromUsers: ["instagram-scrape"] })
    const { container } = render(<HiddenFromUsersMark type="generate-image" />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for anyone the backend told nothing (a user, or pre-fetch)", () => {
    const { container } = render(<HiddenFromUsersMark type="instagram-scrape" />)
    expect(container.firstChild).toBeNull()
    act(() => __resetSurfaceAvailabilityForTests({ nodes: ["instagram-scrape"], models: [] }))
    expect(container.firstChild).toBeNull()
  })

  it("marks a hidden node, with the explanation as its tooltip", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], hiddenFromUsers: ["instagram-scrape"] })
    const { container } = render(<HiddenFromUsersMark type="instagram-scrape" />)
    const mark = container.firstChild as HTMLElement
    expect(mark.textContent).toBe("ADMIN")
    expect(mark.getAttribute("title")).toMatch(/hidden from users/i)
  })

  it("picks the mark up when availability lands after the row mounted", () => {
    const { container } = render(<HiddenFromUsersMark type="instagram-scrape" />)
    expect(container.firstChild).toBeNull()
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [], hiddenFromUsers: ["instagram-scrape"] }))
    expect((container.firstChild as HTMLElement).textContent).toBe("ADMIN")
  })
})
