/**
 * The Schedule Trigger card says what the schedule does and whether it will
 * run: the rules in words, the next run in the schedule's timezone, and a
 * state pill that is green only when the server will actually run it — a
 * switched-on schedule the server has parked (an unreadable timezone, no
 * usable rule) says "Won't run", never "Active".
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useStore: vi.fn(() => 1),
  }
})
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children }: { children?: import("react").ReactNode }) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("@/components/nodes/editable-node-label", () => ({
  EditableNodeLabel: ({ label }: { label?: string }) => <span data-testid="editable-node-label">{label}</span>,
}))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HandleWithPopover: () => null,
  HANDLE_COLORS: { control: "#000" },
  TEXT_HANDLE_COLOR: "#000",
}))

import { ScheduleTriggerNode } from "../schedule-trigger-node"

function renderCard(data: Record<string, unknown>) {
  const props = { id: "s1", data: { label: "Schedule Trigger", ...data }, selected: false } as unknown as NodeProps
  render(<ScheduleTriggerNode {...props} />)
}

const DAILY = { rules: [{ id: "rule-1", kind: "days", every: 1, hour: 9, minute: 0 }] }

describe("ScheduleTriggerNode", () => {
  it("says the rule in words, the next run in the schedule's timezone, and Paused until it is turned on", () => {
    renderCard({ ...DAILY, timezone: "Asia/Jerusalem" })
    expect(screen.getByTestId("schedule-headline")).toHaveTextContent(/Every day at 9:00\s?AM/)
    expect(screen.getByText(/Next run .*· Asia\/Jerusalem/)).toBeInTheDocument()
    expect(screen.getByTestId("schedule-state")).toHaveAttribute("data-state", "paused")
    expect(screen.getByTestId("schedule-state")).toHaveTextContent("Paused")
    expect(screen.getByText("1 run per day")).toBeInTheDocument()
    expect(screen.getByText("1 rule")).toBeInTheDocument()
  })

  it("is Active only when the server will run it", () => {
    renderCard({ ...DAILY, active: true })
    expect(screen.getByTestId("schedule-state")).toHaveAttribute("data-state", "active")
    expect(screen.getByTestId("schedule-state")).toHaveTextContent("Active")
  })

  it("a switched-on schedule the server has parked says Won't run — an unreadable timezone, or no usable rule", () => {
    renderCard({ ...DAILY, active: true, timezone: "Israel Time" })
    expect(screen.getByTestId("schedule-state")).toHaveAttribute("data-state", "blocked")
    expect(screen.getByTestId("schedule-state")).toHaveTextContent("Won't run")
  })

  it("a node written before the rules model shows its converted rule", () => {
    renderCard({ interval: "*/15 * * * *" })
    expect(screen.getByTestId("schedule-headline")).toHaveTextContent("Every 15 minutes")
    expect(screen.getByText("96 runs per day")).toBeInTheDocument()
  })
})
