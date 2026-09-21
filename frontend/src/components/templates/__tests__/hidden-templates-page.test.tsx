import { afterEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import TemplatesPage from "@/app/(dashboard)/templates/page"

afterEach(() => { delete window.__NODARO_RUNTIME__ })

describe("hidden template gallery deep links", () => {
  it.each([
    { nav: { hide: ["templates" as const] } },
    { dashboard: { tabs: ["tutorials" as const] } },
  ])("returns to projects before mounting catalogue queries: %j", async (surface) => {
    window.__NODARO_RUNTIME__ = { surface }
    // No QueryClientProvider: mounting the catalogue here would fail even
    // before it could fetch templates for a deployment that hid them.
    render(<MemoryRouter initialEntries={["/templates"]}><Routes>
      <Route path="/templates" element={<TemplatesPage />} />
      <Route path="/projects" element={<p>Your projects</p>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText("Your projects")).toBeInTheDocument()
  })
})
