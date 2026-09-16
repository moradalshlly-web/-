import { describe, it, expect, vi, beforeEach } from "vitest"

// Table-keyed stub with an update recorder — see welcome-offer-notify.test.ts
// for the shape. `update(...)` resolves ok and records what was written.
const state = {
  tables: {} as Record<string, unknown[]>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
}

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    const filters: Array<[string, unknown]> = []
    let pending: Record<string, unknown> | null = null
    for (const m of ["not", "gt", "gte", "lt", "lte", "in", "order", "limit", "range", "select"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.eq = vi.fn((col: string, v: unknown) => {
      filters.push([col, v])
      return chain
    })
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      pending = patch
      return chain
    })
    chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      if (pending) {
        state.updates.push({ table, patch: pending, filters: [...filters] })
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      }
      return Promise.resolve({ data: state.tables[table] ?? [], error: null }).then(resolve, reject)
    }
    return chain
  })
  return { supabase: { from } }
})

const notifyState = { lastPull: null as string | null }
vi.mock("@/ee/notifications/notify-config.js", () => ({
  readNotifyState: vi.fn(async () => notifyState.lastPull),
  writeNotifyState: vi.fn(async (_k: string, v: string) => {
    notifyState.lastPull = v
  }),
}))

const loops = { configured: true, answers: {} as Record<string, unknown> }
vi.mock("@/ee/lib/loops-client.js", () => ({
  isLoopsConfigured: vi.fn(() => loops.configured),
  findContact: vi.fn(async (email: string) => loops.answers[email] ?? { ok: true, contact: { email, subscribed: true } }),
}))

import { pullLoopsUnsubscribes, isLoopsPullDue } from "../loops-unsubscribe-pull.js"
import { findContact } from "../../lib/loops-client.js"

// 2026-09-16T06:00Z is 09:00 IDT — at/after a digest hour of 8.
const MORNING = new Date("2026-09-16T06:00:00.000Z")
// 2026-09-16T03:00Z is 06:00 IDT — before the digest hour.
const EARLY = new Date("2026-09-16T03:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = {
    user_consents: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }],
    profiles: [
      { id: "u1", email: "ada@example.com" },
      { id: "u2", email: "bob@example.com" },
      { id: "u3", email: "cy@example.com" },
    ],
  }
  state.updates = []
  notifyState.lastPull = null
  loops.configured = true
  loops.answers = {}
})

describe("isLoopsPullDue", () => {
  it("is due at or after the digest hour once per Israel day", () => {
    expect(isLoopsPullDue(MORNING, 8, null)).toBe(true)
    expect(isLoopsPullDue(MORNING, 8, "2026-09-15")).toBe(true)
    expect(isLoopsPullDue(MORNING, 8, "2026-09-16")).toBe(false)
    expect(isLoopsPullDue(EARLY, 8, null)).toBe(false)
  })
})

describe("pullLoopsUnsubscribes", () => {
  it("does nothing when disabled or when Loops is not configured", async () => {
    expect(await pullLoopsUnsubscribes(MORNING, false, 8)).toBeNull()
    loops.configured = false
    expect(await pullLoopsUnsubscribes(MORNING, true, 8)).toBeNull()
    expect(findContact).not.toHaveBeenCalled()
  })

  it("does nothing before the digest hour, and only once a day after it", async () => {
    expect(await pullLoopsUnsubscribes(EARLY, true, 8)).toBeNull()
    expect(findContact).not.toHaveBeenCalled()
    const first = await pullLoopsUnsubscribes(MORNING, true, 8)
    expect(first).not.toBeNull()
    expect(notifyState.lastPull).toBe("2026-09-16")
    vi.mocked(findContact).mockClear()
    expect(await pullLoopsUnsubscribes(new Date(MORNING.getTime() + 3_600_000), true, 8)).toBeNull()
    expect(findContact).not.toHaveBeenCalled()
  })

  it("mirrors a Loops unsubscribe into the row as withdrawn, with a CAS on granted", async () => {
    loops.answers["bob@example.com"] = { ok: true, contact: { email: "bob@example.com", subscribed: false } }
    const s = await pullLoopsUnsubscribes(MORNING, true, 8)
    expect(s).toEqual({ checked: 3, withdrawn: 1, missing: 0, errors: 0 })
    expect(state.updates).toHaveLength(1)
    const u = state.updates[0]
    expect(u.table).toBe("user_consents")
    expect(u.patch).toMatchObject({ status: "withdrawn", withdrawn_at: MORNING.toISOString(), loops_dirty: false })
    expect(u.filters).toEqual(expect.arrayContaining([["user_id", "u2"], ["kind", "marketing_email"], ["status", "granted"]]))
  })

  it("treats a contact Loops no longer has as withdrawn too", async () => {
    loops.answers["cy@example.com"] = { ok: true, contact: null }
    const s = await pullLoopsUnsubscribes(MORNING, true, 8)
    expect(s).toEqual({ checked: 3, withdrawn: 0, missing: 1, errors: 0 })
    expect(state.updates.map((u) => u.filters.find(([c]) => c === "user_id")?.[1])).toEqual(["u3"])
  })

  it("leaves the row alone on a Loops error and counts it", async () => {
    loops.answers["ada@example.com"] = { ok: false, error: "http_500", contact: null }
    const s = await pullLoopsUnsubscribes(MORNING, true, 8)
    expect(s).toEqual({ checked: 2, withdrawn: 0, missing: 0, errors: 1 })
    expect(state.updates).toHaveLength(0)
  })

  it("subscribed contacts change nothing", async () => {
    const s = await pullLoopsUnsubscribes(MORNING, true, 8)
    expect(s).toEqual({ checked: 3, withdrawn: 0, missing: 0, errors: 0 })
    expect(state.updates).toHaveLength(0)
  })
})
