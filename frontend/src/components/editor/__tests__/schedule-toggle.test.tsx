/**
 * The editor's top-bar schedule switch: absent without a Schedule Trigger on
 * the canvas (and read-only); one click flips EVERY schedule node's `active`
 * and saves — the save is what projects the switch onto the trigger row —
 * and the toast waits for the save's answer: a refused save is reported as
 * such, never as "schedule on".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { ScheduleToggle } from "../schedule-toggle"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

const scheduleNodes = () =>
  useWorkflowStore.getState().nodes.filter((n) => n.type === "schedule-trigger").map((n) => (n.data as { active?: boolean }).active)

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.setState({ isReadOnly: false, nodes: [] })
})

describe("ScheduleToggle", () => {
  it("renders nothing without a Schedule Trigger on the canvas", () => {
    useWorkflowStore.setState({ nodes: [node("img", "generate-image", {})] })
    render(<ScheduleToggle onSave={vi.fn()} />)
    expect(screen.queryByTestId("schedule-toggle")).toBeNull()
  })

  it("renders nothing read-only", () => {
    useWorkflowStore.setState({ isReadOnly: true, nodes: [node("s1", "schedule-trigger", { rules: [] })] })
    render(<ScheduleToggle onSave={vi.fn()} />)
    expect(screen.queryByTestId("schedule-toggle")).toBeNull()
  })

  it("turns every schedule on and saves; a second click pauses them all", async () => {
    useWorkflowStore.setState({
      nodes: [node("s1", "schedule-trigger", { rules: [] }), node("s2", "schedule-trigger", { rules: [], active: true }), node("img", "generate-image", {})],
    })
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScheduleToggle onSave={onSave} />)
    const button = screen.getByTestId("schedule-toggle")
    expect(button).toHaveTextContent("1/2 schedules on")
    expect(button).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(button)
    expect(scheduleNodes()).toEqual([true, true])
    expect(onSave).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(screen.getByTestId("schedule-toggle")).toHaveTextContent("Schedule on")
    expect(screen.getByTestId("schedule-toggle")).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByTestId("schedule-toggle"))
    expect(scheduleNodes()).toEqual([false, false])
    expect(onSave).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId("schedule-toggle")).toHaveTextContent("Schedule off")
  })

  it("a refused save is reported as a failure, not as 'schedule on'", async () => {
    useWorkflowStore.setState({ nodes: [node("s1", "schedule-trigger", { rules: [] })] })
    const onSave = vi.fn().mockResolvedValue({ success: false, error: "remote_conflict" })
    render(<ScheduleToggle onSave={onSave} />)
    fireEvent.click(screen.getByTestId("schedule-toggle"))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1))
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("a save that throws is reported the same way, and the button is usable again", async () => {
    useWorkflowStore.setState({ nodes: [node("s1", "schedule-trigger", { rules: [] })] })
    const onSave = vi.fn().mockRejectedValue(new Error("network"))
    render(<ScheduleToggle onSave={onSave} />)
    fireEvent.click(screen.getByTestId("schedule-toggle"))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId("schedule-toggle")).not.toBeDisabled())
  })
})
