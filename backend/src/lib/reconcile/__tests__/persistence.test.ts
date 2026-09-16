import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the supabase singleton BEFORE importing the module under test.
const updateMock = vi.fn().mockReturnThis()
const eqMock = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: updateMock,
      eq: eqMock,
    })),
  },
}))

import { supabase } from "../../supabase.js"
import { makeOnTaskCreated, markProviderCallStart, refreshPreTaskSentinel } from "../persistence.js"

describe("refreshPreTaskSentinel — the heartbeat's CAS", () => {
  /** update().eq().eq().eq(), awaited at the last `.eq`. */
  function casChain(result: { data: unknown; error: { message: string } | null } = { data: null, error: null }) {
    const eqCalls: Array<[string, unknown]> = []
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => { eqCalls.push([column, value]); return chain }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    }
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain)
    return { chain, eqCalls }
  }

  it("moves only provider_call_started_at, and only on a processing row still under pre-task", async () => {
    const { chain, eqCalls } = casChain()
    await refreshPreTaskSentinel("job-live")

    expect(supabase.from).toHaveBeenCalledWith("jobs")
    const [patch] = chain.update.mock.calls[0] as unknown as [Record<string, unknown>]
    // Never provider_kind: writing it would resurrect a cleared sentinel (gvp/evp)
    // or turn a real async kind back into fail + refund.
    expect(Object.keys(patch)).toEqual(["provider_call_started_at"])
    expect(new Date(patch.provider_call_started_at as string).getTime()).toBeGreaterThan(Date.now() - 5000)
    expect(eqCalls).toEqual([["id", "job-live"], ["provider_kind", "pre-task"], ["status", "processing"]])
  })

  it("does not throw when the write reports an error (the next beat retries)", async () => {
    casChain({ data: null, error: { message: "transient" } })
    await expect(refreshPreTaskSentinel("job-x")).resolves.toBeUndefined()
  })

  it("does not throw when the client itself throws", async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error("network down") })
    await expect(refreshPreTaskSentinel("job-y")).resolves.toBeUndefined()
  })
})

describe("makeOnTaskCreated", () => {
  beforeEach(() => {
    updateMock.mockClear()
    eqMock.mockClear()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockClear()
  })

  it("returns a callback that writes provider_kind, provider_task_id, and provider_call_started_at to jobs", async () => {
    const cb = makeOnTaskCreated("job-123", "kie-standard")
    await cb("kie-task-abc")
    expect(supabase.from).toHaveBeenCalledWith("jobs")
    expect(updateMock).toHaveBeenCalledTimes(1)
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.provider_kind).toBe("kie-standard")
    expect(updateArg.provider_task_id).toBe("kie-task-abc")
    expect(typeof updateArg.provider_call_started_at).toBe("string")
    expect(new Date(updateArg.provider_call_started_at).getTime()).toBeGreaterThan(Date.now() - 5000)
    expect(eqMock).toHaveBeenCalledWith("id", "job-123")
  })

  it("does not throw if the DB write fails (best-effort)", async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: "transient" } })
    const cb = makeOnTaskCreated("job-456", "kie-veo")
    await expect(cb("task-x")).resolves.toBeUndefined()
  })

  it("does not throw if the underlying call throws", async () => {
    eqMock.mockRejectedValueOnce(new Error("network down"))
    const cb = makeOnTaskCreated("job-789", "kie-suno")
    await expect(cb("task-y")).resolves.toBeUndefined()
  })
})

describe("markProviderCallStart", () => {
  beforeEach(() => {
    updateMock.mockClear()
    eqMock.mockClear()
  })

  it("writes provider_kind + provider_call_started_at (no provider_task_id)", async () => {
    await markProviderCallStart("job-789", "anthropic-sync")
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.provider_kind).toBe("anthropic-sync")
    expect(updateArg.provider_task_id).toBeUndefined()
    expect(typeof updateArg.provider_call_started_at).toBe("string")
    expect(eqMock).toHaveBeenCalledWith("id", "job-789")
  })

  it("does not throw if the DB write fails", async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: "transient" } })
    await expect(markProviderCallStart("job-x", "elevenlabs-sync")).resolves.toBeUndefined()
  })
})
