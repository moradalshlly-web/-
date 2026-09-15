import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, createClient: () => ({ auth: {} }) }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getAppRuns: vi.fn(async () => ({ data: [], nextCursor: null })),
  createAppRun: vi.fn(async () => ({ id: "11111111-2222-4333-8444-555555555555", createdAt: new Date(0).toISOString() })),
  updateAppRunInputs: vi.fn(async () => ({ id: "x", inputValues: {} })),
  runPublishedApp: vi.fn(async () => ({ executionId: "exec-1", runId: "run-1" })),
}))

import { useRunSlots } from "../use-run-slots"
import { ORIGINAL_SLOT_ID } from "../types"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { updateAppRunInputs, runPublishedApp } from "@/lib/api"

const DB_RUN_ID = "11111111-2222-4333-8444-555555555555"

const app = {
  id: "app-1",
  name: "Test app",
  createdAt: new Date(0).toISOString(),
  version: 1,
  versions: [{ version: 1 }],
} as unknown as NonNullable<ReturnType<typeof useAppRunnerStore.getState>["app"]>

const nodes = [
  { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Prompt", text: "hi" } },
] as unknown as ReturnType<typeof usePresentationStore.getState>["nodes"]

function mount() {
  return renderHook(() =>
    useRunSlots({ slug: "test-app", user: { id: "u1" }, persistRuns: true }),
  )
}

/**
 * The Original slot is synthetic: no `app_runs` row, and its id is the literal
 * "original". Both run endpoints parse the id with `z.string().uuid()`, so any
 * write carrying it is a 400 + an app_reports validation-reject row, never a
 * silent no-op. These are the gestures that reach a write while it is active.
 */
describe("useRunSlots — the synthetic Original slot never reaches the API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The auto-select effect also sizes the sidebar; jsdom has no matchMedia.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    useAppRunnerStore.setState({ slug: "test-app", app, executionStatus: "idle", nodeStates: {}, runtimes: {} })
    usePresentationStore.setState({ inputValues: {}, nodes, edges: [] })
  })

  it("selects Original by default", async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.activeSlotId).toBe(ORIGINAL_SLOT_ID))
  })

  it("New Run from Original does not PATCH the synthetic id", async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.activeSlotId).toBe(ORIGINAL_SLOT_ID))

    await act(async () => {
      await result.current.handleCreateNew()
    })

    expect(updateAppRunInputs).not.toHaveBeenCalled()
  })

  it("Clear and Rename from Original do not PATCH the synthetic id", async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.activeSlotId).toBe(ORIGINAL_SLOT_ID))

    act(() => {
      result.current.handleClear()
      result.current.handleRenameSlot(ORIGINAL_SLOT_ID, "nope")
    })

    expect(updateAppRunInputs).not.toHaveBeenCalled()
  })

  it("Run from Original omits the synthetic runId instead of sending it", async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.activeSlotId).toBe(ORIGINAL_SLOT_ID))

    await act(async () => {
      await usePresentationStore.getState().run()
    })

    expect(updateAppRunInputs).not.toHaveBeenCalled()
    expect(runPublishedApp).toHaveBeenCalledTimes(1)
    expect((runPublishedApp as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeUndefined()
  })

  it("still persists a real (DB-backed) slot", async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.activeSlotId).toBe(ORIGINAL_SLOT_ID))

    await act(async () => {
      await result.current.handleCreateNew()
    })
    await waitFor(() => expect(result.current.activeSlotId).toBe(DB_RUN_ID))

    act(() => {
      result.current.handleClear()
    })

    expect(updateAppRunInputs).toHaveBeenCalledTimes(1)
    const call = (updateAppRunInputs as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("test-app")
    expect(call[1]).toBe(DB_RUN_ID)
  })
})
