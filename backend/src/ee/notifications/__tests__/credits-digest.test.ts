import { describe, it, expect, vi, beforeEach } from "vitest"

// Table-keyed stub (same shape as welcome-offer-notify.test.ts): a query on a
// table resolves that table's staged rows; filters are ignored, so each test
// stages exactly the rows the window would return. `range` pages through the
// staged rows so the pagination loop is exercised for real.
const state = {
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, unknown>,
}

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    let slice: [number, number] | null = null
    let limit: number | null = null
    const chain: Record<string, unknown> = {}
    for (const m of ["eq", "neq", "not", "gt", "gte", "lt", "lte", "in", "order", "select"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.range = vi.fn((from: number, to: number) => {
      slice = [from, to]
      return chain
    })
    chain.limit = vi.fn((n: number) => {
      limit = n
      return chain
    })
    chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      let rows = state.tables[table] ?? []
      if (slice) rows = rows.slice(slice[0], slice[1] + 1)
      if (limit !== null) rows = rows.slice(0, limit)
      return Promise.resolve({ data: rows, error: state.errors[table] ?? null }).then(resolve, reject)
    }
    return chain
  })
  return { supabase: { from } }
})

const notifyState = { lastDate: null as string | null }
vi.mock("@/ee/notifications/notify-config.js", () => ({
  readNotifyState: vi.fn(async () => notifyState.lastDate),
  writeNotifyState: vi.fn(async (_k: string, v: string) => {
    notifyState.lastDate = v
  }),
}))

import {
  aggregateUsage,
  kieSpendFromSnapshots,
  kieCreditsToUsd,
  buildCreditsDigestMessage,
  maybeSendCreditsDigest,
  num,
  CREDITS_DIGEST_MAX_USERS,
  type UsageLogRow,
} from "../credits-digest.js"
import { writeNotifyState } from "../notify-config.js"
import { supabase } from "@/lib/supabase.js"

// 08:05 Israel time on 2026-09-16 (IDT = UTC+3) → the digest hour is 8.
const NOW = new Date("2026-09-16T05:05:00.000Z")

const row = (over: Partial<UsageLogRow> = {}): UsageLogRow => ({
  user_id: "u1",
  job_id: "j1",
  status: "committed",
  credits_charged: 100,
  credits_used: 120,
  cost_usd: "0",
  ...over,
})

let posted: Array<{ text: string; blocks?: unknown[] }>
const post = vi.fn(async (msg: { text: string; blocks?: unknown[] }) => {
  posted.push(msg)
  return true
})

beforeEach(() => {
  vi.clearAllMocks()
  posted = []
  notifyState.lastDate = null
  state.tables = {}
  state.errors = {}
})

describe("num — DECIMAL columns arrive as strings", () => {
  it("parses numeric strings, passes numbers through, zeroes garbage and nulls", () => {
    expect(num("0.125")).toBe(0.125)
    expect(num(3)).toBe(3)
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num("abc")).toBe(0)
  })
})

describe("aggregateUsage", () => {
  it("sums committed credits per user, prefers credits_charged, and sorts by credits desc", () => {
    const rows = [
      row({ user_id: "a", credits_charged: 100, credits_used: 150 }),
      row({ user_id: "b", credits_charged: null, credits_used: 300, job_id: "j2" }),
      row({ user_id: "a", credits_charged: 50, credits_used: 50, job_id: "j3" }),
    ]
    const agg = aggregateUsage(rows, new Map())
    expect(agg.perUser.map((u) => [u.userId, u.credits, u.runs])).toEqual([
      ["b", 300, 1],
      ["a", 150, 2],
    ])
    expect(agg.totalCredits).toBe(450)
    expect(agg.runs).toBe(3)
  })

  it("takes USD from jobs.provider_cost when known, else the reservation estimate — both string-typed", () => {
    const rows = [
      row({ user_id: "a", job_id: "j1", cost_usd: "0.010000" }),
      row({ user_id: "a", job_id: "j2", cost_usd: "0.020000" }),
      row({ user_id: "a", job_id: null, cost_usd: "0.005000" }),
    ]
    const agg = aggregateUsage(rows, new Map([["j1", 0.5]]))
    expect(agg.perUser[0].usd).toBeCloseTo(0.5 + 0.02 + 0.005, 9)
    expect(agg.totalUsd).toBeCloseTo(0.525, 9)
  })

  it("reports reserved rows as in-flight and never counts refunded rows", () => {
    const rows = [
      row({ user_id: "a", status: "committed", credits_charged: 100 }),
      row({ user_id: "a", status: "reserved", credits_used: 40, credits_charged: null }),
      row({ user_id: "a", status: "refunded", credits_used: 999, credits_charged: null }),
    ]
    const agg = aggregateUsage(rows, new Map())
    expect(agg.totalCredits).toBe(100)
    expect(agg.runs).toBe(1)
    expect(agg.inFlightCredits).toBe(40)
    expect(agg.inFlightRuns).toBe(1)
  })
})

describe("kieSpendFromSnapshots — balance movement from hourly readings", () => {
  it("classes drops as burn and rises as top-ups, using the pre-window baseline for the first hour", () => {
    const spend = kieSpendFromSnapshots({ credits: "1000", recorded_at: "2026-09-14T20:15:00Z" }, [
      { credits: 900, recorded_at: "2026-09-14T21:15:00Z" }, // -100
      { credits: 700, recorded_at: "2026-09-14T22:15:00Z" }, // -200
      { credits: 2700, recorded_at: "2026-09-14T23:15:00Z" }, // +2000 top-up
      { credits: 2650, recorded_at: "2026-09-15T00:15:00Z" }, // -50
    ])
    expect(spend.burnedCredits).toBe(350)
    expect(spend.toppedUpCredits).toBe(2000)
    expect(spend.topUps).toBe(1)
    expect(spend.lastBalance).toBe(2650)
  })

  it("sorts unordered readings by time before differencing", () => {
    const spend = kieSpendFromSnapshots(null, [
      { credits: 500, recorded_at: "2026-09-14T23:15:00Z" },
      { credits: 800, recorded_at: "2026-09-14T21:15:00Z" },
      { credits: 600, recorded_at: "2026-09-14T22:15:00Z" },
    ])
    expect(spend.burnedCredits).toBe(300)
    expect(spend.toppedUpCredits).toBe(0)
    expect(spend.lastBalance).toBe(500)
  })

  it("with no baseline the first reading only anchors — it is not a delta", () => {
    const spend = kieSpendFromSnapshots(null, [{ credits: 5000, recorded_at: "2026-09-14T21:15:00Z" }])
    expect(spend.burnedCredits).toBe(0)
    expect(spend.toppedUpCredits).toBe(0)
    expect(spend.lastBalance).toBe(5000)
  })

  it("returns a null balance when there were no readings in the window", () => {
    expect(kieSpendFromSnapshots({ credits: 10, recorded_at: "2026-09-14T20:15:00Z" }, []).lastBalance).toBeNull()
  })

  it("converts KIE credits to USD at the provider's rate", () => {
    expect(kieCreditsToUsd(2000)).toBeCloseTo(10, 9)
  })
})

describe("buildCreditsDigestMessage", () => {
  const identities = new Map([
    ["a", { email: "ada@example.com", internal: false }],
    ["b", { email: "bob@nodaro.ai", internal: true }],
  ])

  it("renders headline totals, one line per user with the internal tag, and the KIE footer", () => {
    const agg = aggregateUsage(
      [row({ user_id: "a", credits_charged: 3000, job_id: "j1" }), row({ user_id: "b", credits_charged: 1000, job_id: "j2" })],
      new Map([
        ["j1", 4.5],
        ["j2", 1.25],
      ]),
    )
    const kie = kieSpendFromSnapshots({ credits: 1000, recorded_at: "2026-09-14T20:15:00Z" }, [
      { credits: 800, recorded_at: "2026-09-14T22:15:00Z" },
      { credits: 2800, recorded_at: "2026-09-14T23:15:00Z" },
    ])
    const msg = buildCreditsDigestMessage("2026-09-15", agg, identities, kie)
    expect(msg.text).toBe("Credits 2026-09-15: 4,000 cr · cost to us $5.75")
    const json = JSON.stringify(msg.blocks)
    expect(json).toContain("ada@example.com — *3,000* cr — $4.50 · 1 run")
    expect(json).toContain("bob@nodaro.ai (internal) — *1,000* cr — $1.25 · 1 run")
    expect(json).toContain("burned *$1.00*")
    expect(json).toContain("topped up *$10.00* (1 purchase)")
    expect(json).toContain("balance 2,800 cr ≈ $14.00")
    expect(json).toContain("Tracked per-run cost $5.75 vs balance drop $1.00")
    expect(json).toContain("no balance feed")
  })

  it("says so when KIE has no readings, and on a zero-credit day still produces a message", () => {
    const msg = buildCreditsDigestMessage("2026-09-15", aggregateUsage([], new Map()), new Map(), null)
    expect(msg.text).toBe("Credits 2026-09-15: 0 cr · cost to us $0.00")
    const json = JSON.stringify(msg.blocks)
    expect(json).toContain("No credits were charged")
    expect(json).toContain("no balance readings for this day")
  })

  it("mentions in-flight reservations only when there are some", () => {
    const withInFlight = aggregateUsage([row({ status: "reserved", credits_used: 40, credits_charged: null })], new Map())
    expect(JSON.stringify(buildCreditsDigestMessage("d", withInFlight, new Map(), null).blocks)).toContain(
      "1 run from that day still in flight (40 cr reserved, not counted above)",
    )
    expect(JSON.stringify(buildCreditsDigestMessage("d", aggregateUsage([], new Map()), new Map(), null).blocks)).not.toContain(
      "in flight",
    )
  })

  it("folds users past the cap into one line whose figures are the remainder's sum", () => {
    const rows = Array.from({ length: CREDITS_DIGEST_MAX_USERS + 3 }, (_, i) =>
      row({ user_id: `u${i}`, job_id: `j${i}`, credits_charged: 1000 - i, cost_usd: "0.01" }),
    )
    const msg = buildCreditsDigestMessage("d", aggregateUsage(rows, new Map()), new Map(), null)
    const json = JSON.stringify(msg.blocks)
    // The three smallest (960, 959, 958 credits) are the fold.
    expect(json).toContain("…and 3 more users — 2,877 cr — $0.03")
    expect(json).not.toContain("u42 —")
    expect(json).toContain("u0 — *1,000* cr")
  })
})

describe("maybeSendCreditsDigest — the tick gate", () => {
  it("does nothing when disabled", async () => {
    await maybeSendCreditsDigest(NOW, false, 8, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("does nothing outside the digest hour", async () => {
    await maybeSendCreditsDigest(NOW, true, 9, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("does nothing when today is already marked sent", async () => {
    notifyState.lastDate = "2026-09-16"
    await maybeSendCreditsDigest(NOW, true, 8, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("sends yesterday's digest at the hour, joins provider costs and emails, and marks the day", async () => {
    state.tables.usage_logs = [
      row({ user_id: "a", job_id: "j1", credits_charged: 200 }),
      row({ user_id: "a", job_id: "j2", credits_charged: 100 }),
    ]
    state.tables.jobs = [
      { id: "j1", provider_cost: "0.300000" },
      { id: "j2", provider_cost: null },
    ]
    state.tables.profiles = [{ id: "a", email: "ada@example.com", role: "user" }]
    state.tables.kie_credit_snapshots = []

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(post).toHaveBeenCalledOnce()
    expect(posted[0].text).toBe("Credits 2026-09-15: 300 cr · cost to us $0.30")
    expect(JSON.stringify(posted[0].blocks)).toContain("ada@example.com — *300* cr — $0.30 · 2 runs")
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_credits_digest_date", "2026-09-16")

    // The window is the Israel calendar day of 2026-09-15 (IDT, UTC+3):
    // [2026-09-14T21:00Z, 2026-09-15T21:00Z) — half-open, so a midnight row
    // lands in exactly one digest.
    const fromCalls = vi.mocked(supabase.from).mock
    const usageChain = fromCalls.results[fromCalls.calls.findIndex(([t]) => t === "usage_logs")].value as {
      gte: ReturnType<typeof vi.fn>
      lt: ReturnType<typeof vi.fn>
      neq: ReturnType<typeof vi.fn>
    }
    expect(usageChain.gte).toHaveBeenCalledWith("created_at", "2026-09-14T21:00:00.000Z")
    expect(usageChain.lt).toHaveBeenCalledWith("created_at", "2026-09-15T21:00:00.000Z")
    expect(usageChain.neq).toHaveBeenCalledWith("status", "refunded")
  })

  it("keeps sending when a jobs.provider_cost chunk fails — those rows fall back to the estimate", async () => {
    state.tables.usage_logs = [row({ user_id: "a", job_id: "j1", credits_charged: 10, cost_usd: "0.040000" })]
    state.errors.jobs = { message: "URI too long" }
    state.tables.profiles = []
    state.tables.kie_credit_snapshots = []
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(post).toHaveBeenCalledOnce()
    expect(posted[0].text).toBe("Credits 2026-09-15: 10 cr · cost to us $0.04")
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_credits_digest_date", "2026-09-16")
    quiet.mockRestore()
  })

  it("pages through usage_logs past PostgREST's 1000-row cap", async () => {
    state.tables.usage_logs = Array.from({ length: 1500 }, (_, i) =>
      row({ user_id: "a", job_id: `j${i}`, credits_charged: 1 }),
    )
    state.tables.jobs = []
    state.tables.profiles = [{ id: "a", email: "ada@example.com", role: "user" }]
    state.tables.kie_credit_snapshots = []

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(posted[0].text).toBe("Credits 2026-09-15: 1,500 cr · cost to us $0.00")
    const usageCalls = vi.mocked(supabase.from).mock.calls.filter(([t]) => t === "usage_logs")
    expect(usageCalls.length).toBe(2)
  })

  it("leaves the day unmarked when the Slack post fails, so the next tick retries", async () => {
    state.tables.usage_logs = []
    state.tables.kie_credit_snapshots = []
    post.mockImplementationOnce(async (msg) => {
      posted.push(msg)
      return false
    })

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(post).toHaveBeenCalledOnce()
    expect(writeNotifyState).not.toHaveBeenCalled()
    expect(notifyState.lastDate).toBeNull()
  })

  it("does not send and does not mark the day when the usage query errors — and says so in the log", async () => {
    state.errors.usage_logs = { message: "boom" }
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledWith("[notify] credits digest failed:", expect.any(Error))
    logged.mockRestore()
  })

  it("still sends the credits half when the KIE snapshot read errors", async () => {
    state.tables.usage_logs = [row({ user_id: "a", credits_charged: 10 })]
    state.tables.jobs = []
    state.tables.profiles = []
    state.errors.kie_credit_snapshots = { message: "boom" }

    await maybeSendCreditsDigest(NOW, true, 8, post)

    expect(post).toHaveBeenCalledOnce()
    expect(JSON.stringify(posted[0].blocks)).toContain("no balance readings for this day")
  })
})
