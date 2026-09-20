// The button's contract, against the REAL store and the REAL undo history:
// one click clears, one Undo brings everything back, and nothing else on the
// history is disturbed. `updateNodeData` exempts execution-only patches from
// undo — if the clear ever went through it, it would be un-undoable, which is
// the one thing the feature was asked not to be.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const toastMock = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUndoRedoStore } from "@/hooks/use-undo-redo-store"
import { flushPendingUndoSnapshot, useUndoRedoActions, useUndoRedoSubscription } from "@/hooks/use-undo-redo"
import { clearWorkflowResults } from "../clear-results-action"

const RESULT = { url: "https://cdn.test/a.png", jobId: "j1", timestamp: "2026-09-20T00:00:00Z" }

function node(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
}

const GRAPH: WorkflowNode[] = [
  node("txt", "text-prompt", { text: "a red fox" }),
  node("img", "generate-image", {
    prompt: "{txt}",
    generatedImageUrl: RESULT.url,
    generatedResults: [RESULT],
    activeResultIndex: 0,
    executionStatus: "completed",
  }),
  node("vid", "generate-video", { prompt: "slow push in", generatedVideoUrl: "https://cdn.test/v.mp4", executionStatus: "failed", errorMessage: "no" }),
]
const EDGES = [{ id: "e1", source: "txt", target: "img", targetHandle: "prompt" }] as unknown as WorkflowEdge[]

/** `activeResultIndex: 0` already reads as "no result", so the clear leaves it be. */
const CLEARED_IMG = { label: "img", prompt: "{txt}", activeResultIndex: 0 }

const rawDataOf = (id: string) => (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data ?? {}) as Record<string, unknown>
/** Node data without the clear's own stamp (asserted on its own below). */
const dataOf = (id: string) => {
  const { resultsClearedAt: _stamp, ...rest } = rawDataOf(id)
  return rest
}
const history = () => useUndoRedoStore.getState()

let undo: () => void
let redo: () => void
let unmount: () => void

/** Let the undo history's 300 ms burst window close. */
function tick(): void {
  act(() => {
    vi.advanceTimersByTime(400)
  })
}

/** The Undo the toast was given — what a click on it runs. */
function toastUndo(): () => void {
  const options = toastMock.success.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined
  expect(options?.action, "the confirmation toast carries no Undo").toBeTruthy()
  return options!.action!.onClick
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  const subscription = renderHook(() => useUndoRedoSubscription())
  const actions = renderHook(() => useUndoRedoActions())
  undo = () => act(() => actions.result.current.undo())
  redo = () => act(() => actions.result.current.redo())
  unmount = () => {
    subscription.unmount()
    actions.unmount()
  }
  act(() => {
    useWorkflowStore.setState({ nodes: GRAPH, edges: EDGES, isDirty: false, isReadOnly: false })
  })
  act(() => {
    flushPendingUndoSnapshot()
    history().clear()
  })
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

describe("clearing", () => {
  it("clears every result in one store update, marks the workflow dirty once, and reports it", () => {
    const epoch = useWorkflowStore.getState().dirtyEpoch
    let updates = 0
    const unsubscribe = useWorkflowStore.subscribe(() => updates++)

    let outcome: string | undefined
    act(() => {
      outcome = clearWorkflowResults(undo)
    })
    unsubscribe()

    expect(outcome).toBe("cleared")
    expect(updates).toBe(1)
    expect(dataOf("img")).toEqual(CLEARED_IMG)
    expect(dataOf("vid")).toEqual({ label: "vid", prompt: "slow push in" })
    expect(dataOf("txt")).toEqual({ label: "txt", text: "a red fox" })
    expect(useWorkflowStore.getState().edges).toEqual(EDGES)
    expect(useWorkflowStore.getState().isDirty).toBe(true)
    expect(useWorkflowStore.getState().dirtyEpoch).toBe(epoch + 1)
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.success.mock.calls[0][0]).toContain("2")
  })

  it("stamps the cleared nodes with the time of the clear — never earlier than the last acknowledged save", () => {
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"))
    act(() => void clearWorkflowResults(undo))
    expect(rawDataOf("img").resultsClearedAt).toBe("2026-09-20T10:00:00.000Z")
    expect(rawDataOf("txt").resultsClearedAt).toBeUndefined()

    // A device clock that runs BEHIND the server must not date the clear before
    // the save that carried the results it is clearing.
    undo()
    act(() => useWorkflowStore.setState({ loadedUpdatedAt: "2026-09-20T10:05:00.000Z" }))
    act(() => void clearWorkflowResults(undo))
    expect(rawDataOf("img").resultsClearedAt).toBe("2026-09-20T10:05:00.001Z")
  })

  it("is ONE undo step, and that step brings every result back", () => {
    act(() => void clearWorkflowResults(undo))
    tick()
    expect(history().past).toHaveLength(1)

    undo()
    expect(useWorkflowStore.getState().nodes.map((n) => n.data)).toEqual(GRAPH.map((n) => n.data))
    expect(history().past).toHaveLength(0)

    redo()
    expect(dataOf("img")).toEqual(CLEARED_IMG)
  })

  it("does not swallow the edit made a moment before it into the same step", () => {
    act(() => useWorkflowStore.getState().updateNodeData("txt", { text: "a blue fox" }))
    // No timer advance: the edit's 300 ms burst is still open when Clear is clicked.
    act(() => void clearWorkflowResults(undo))

    undo()
    expect(dataOf("img").generatedImageUrl).toBe(RESULT.url)
    expect(dataOf("txt").text).toBe("a blue fox")

    undo()
    expect(dataOf("txt").text).toBe("a red fox")
  })
})

describe("the Undo on the confirmation toast", () => {
  it("brings the results back", () => {
    act(() => void clearWorkflowResults(undo))
    act(() => toastUndo()())
    expect(dataOf("img").generatedResults).toEqual([RESULT])
    expect(dataOf("vid").errorMessage).toBe("no")
  })

  it("still undoes the CLEAR when something was edited after it — not just that edit", () => {
    act(() => void clearWorkflowResults(undo))
    tick()
    act(() => useWorkflowStore.getState().updateNodeData("txt", { text: "a blue fox" }))
    tick()

    toastMock.info.mockClear()
    act(() => toastUndo()())
    expect(dataOf("img").generatedImageUrl).toBe(RESULT.url)
    expect(dataOf("txt").text).toBe("a red fox")
    // The later edit was not lost: it is on Redo, behind the clear.
    expect(history().future).toHaveLength(2)
    // …and the button SAID it took more than the clear.
    expect(toastMock.info).toHaveBeenCalledTimes(1)
    expect(String(toastMock.info.mock.calls[0][0])).toContain("1")
  })

  it("stays quiet when it undid exactly the clear", () => {
    act(() => void clearWorkflowResults(undo))
    toastMock.info.mockClear()
    act(() => toastUndo()())
    expect(toastMock.info).not.toHaveBeenCalled()
  })

  it("does nothing more when Ctrl+Z already took the clear back", () => {
    act(() => useWorkflowStore.getState().updateNodeData("txt", { text: "an older edit" }))
    tick()
    act(() => void clearWorkflowResults(undo))
    tick()

    undo()
    expect(dataOf("img").generatedImageUrl).toBe(RESULT.url)

    toastMock.info.mockClear()
    act(() => toastUndo()())
    // The older step is still there — the toast did not reach past its own clear.
    expect(dataOf("txt").text).toBe("an older edit")
    expect(history().past).toHaveLength(1)
    // A button that did nothing says why.
    expect(toastMock.info).toHaveBeenCalledTimes(1)
  })

  it("says so, and touches nothing, when the history was reset under it (another tab's save was adopted)", () => {
    act(() => void clearWorkflowResults(undo))
    tick()
    act(() => history().clear())
    const before = useWorkflowStore.getState().nodes
    toastMock.info.mockClear()
    act(() => toastUndo()())
    expect(useWorkflowStore.getState().nodes).toBe(before)
    expect(toastMock.info).toHaveBeenCalledTimes(1)
  })
})

describe("refusing", () => {
  it("refuses while a run is in progress, and says so", () => {
    act(() => useWorkflowStore.getState().markNodesStatus(["vid"], "running"))
    const before = useWorkflowStore.getState().nodes
    let outcome: string | undefined
    act(() => {
      outcome = clearWorkflowResults(undo)
    })
    expect(outcome).toBe("busy")
    expect(useWorkflowStore.getState().nodes).toBe(before)
    expect(toastMock.info).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("says there is nothing to clear on a canvas that never ran — and leaves no undo step", () => {
    act(() => {
      useWorkflowStore.setState({ nodes: [GRAPH[0], node("img", "generate-image", { prompt: "p" })], isDirty: false })
    })
    act(() => {
      flushPendingUndoSnapshot()
      history().clear()
    })

    let outcome: string | undefined
    act(() => {
      outcome = clearWorkflowResults(undo)
    })
    tick()
    expect(outcome).toBe("nothing")
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    expect(history().past).toHaveLength(0)
    expect(toastMock.info).toHaveBeenCalledTimes(1)
  })

  it("never touches a read-only canvas", () => {
    act(() => useWorkflowStore.setState({ isReadOnly: true }))
    const before = useWorkflowStore.getState().nodes
    let outcome: string | undefined
    act(() => {
      outcome = clearWorkflowResults(undo)
    })
    expect(outcome).toBe("read-only")
    expect(useWorkflowStore.getState().nodes).toBe(before)
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})

describe("editGraph — the store action underneath", () => {
  it("changes nothing, and reports false, when the edit returns null", () => {
    const before = useWorkflowStore.getState()
    let changed = true
    act(() => {
      changed = useWorkflowStore.getState().editGraph(() => null)
    })
    expect(changed).toBe(false)
    expect(useWorkflowStore.getState().nodes).toBe(before.nodes)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    expect(useWorkflowStore.getState().dirtyEpoch).toBe(before.dirtyEpoch)
  })

  it("is refused on a read-only canvas without calling the edit", () => {
    act(() => useWorkflowStore.setState({ isReadOnly: true }))
    const edit = vi.fn(() => ({ nodes: [], edges: [] }))
    let changed = true
    act(() => {
      changed = useWorkflowStore.getState().editGraph(edit)
    })
    expect(changed).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(useWorkflowStore.getState().nodes).toHaveLength(GRAPH.length)
  })
})
