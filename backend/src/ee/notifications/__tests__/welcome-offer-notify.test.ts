import { describe, it, expect, vi, beforeEach } from "vitest"

// Table-keyed stub: every query on a table resolves that table's staged rows
// (filters are ignored — the module re-checks windows and statuses in JS, so
// the staging below is exactly the honesty the production path also has).
// Count queries (`head: true`) resolve the staged `counts` entry.
const state = {
  tables: {} as Record<string, unknown[]>,
  counts: {} as Record<string, { count: number | null; error: unknown }>,
  errors: {} as Record<string, unknown>,
}

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    let head = false
    const chain: Record<string, unknown> = {}
    for (const m of ["eq", "not", "gt", "gte", "lt", "lte", "in", "order", "limit", "range"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.select = vi.fn((_cols: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head)
      return chain
    })
    chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const out = head
        ? { data: null, ...(state.counts[table] ?? { count: null, error: null }) }
        : { data: state.tables[table] ?? [], error: state.errors[table] ?? null }
      return Promise.resolve(out).then(resolve, reject)
    }
    return chain
  })
  return { supabase: { from } }
})

const notifyState = { cursor: null as string | null }
vi.mock("@/ee/notifications/notify-config.js", () => ({
  readNotifyState: vi.fn(async () => notifyState.cursor),
  writeNotifyState: vi.fn(async (_k: string, v: string) => {
    notifyState.cursor = v
  }),
}))
vi.mock("@/ee/notifications/signup-product.js", () => ({
  signupProduct: vi.fn(async () => "app"),
}))

import { pollWelcomeOffer, humaniseDelta, welcomeLabel, welcomeLabelsFor, countSubscribed } from "../welcome-offer-notify.js"
import { writeNotifyState } from "../notify-config.js"

const CURSOR = "2026-09-16T08:00:00.000Z"
const NOW = new Date("2026-09-16T08:05:00.000Z")
const SIGNUP = "2026-09-14T03:55:00.000Z" // 2d 4h 10m before an accept at 08:05

const profile = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "ada@example.com",
  role: "user",
  created_at: SIGNUP,
  welcome_offer_seen_at: null,
  free_grant_state: "granted",
  ...over,
})
const consent = (over: Record<string, unknown> = {}) => ({
  user_id: "u1",
  status: "granted",
  granted_at: "2026-09-16T08:03:00.000Z",
  declined_at: null,
  withdrawn_at: null,
  source_app: "studio",
  ...over,
})

let posted: string[]
const post = vi.fn(async (msg: { text: string }) => {
  posted.push(msg.text)
  return true
})

beforeEach(() => {
  vi.clearAllMocks()
  posted = []
  state.tables = {}
  state.counts = {}
  state.errors = {}
  notifyState.cursor = CURSOR
})

describe("humaniseDelta", () => {
  it("reads minutes, hours, and days with a remainder", () => {
    expect(humaniseDelta(2 * 60_000)).toBe("2m")
    expect(humaniseDelta(3 * 3_600_000)).toBe("3h")
    expect(humaniseDelta((2 * 24 + 4) * 3_600_000 + 10 * 60_000)).toBe("2d 4h")
    expect(humaniseDelta(3 * 24 * 3_600_000)).toBe("3d")
  })
})

describe("pollWelcomeOffer — cursor", () => {
  it("initialises the cursor to now and posts nothing on the first tick", async () => {
    notifyState.cursor = null
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).toHaveBeenCalledWith("notify_welcome_cursor", NOW.toISOString())
  })

  it("advances the cursor while disabled without posting", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, false, post)
    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).toHaveBeenCalledWith("notify_welcome_cursor", NOW.toISOString())
  })
})

describe("pollWelcomeOffer — accepted", () => {
  it("posts a plain accept with the source app and the time since signup", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([":white_check_mark: Welcome credits accepted — ada@example.com (studio) · 2d 4h after signup"])
  })

  it("says how much earlier the popup was dismissed when they came back", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-14T04:03:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("dismissed 2d 4h earlier, came back")
  })

  it("treats a dismiss followed by an accept within 10 minutes as a plain accept", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T07:58:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).not.toContain("came back")
    expect(posted[0]).not.toContain("dismissed")
  })

  it("flags withheld credits", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ free_grant_state: "withheld" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted[0]).toContain("credits WITHHELD (shared machine)")
  })

  it("ignores a grant stamp outside the window and a non-granted row", async () => {
    state.tables.user_consents = [consent({ granted_at: "2026-09-16T07:00:00.000Z" }), consent({ user_id: "u2", status: "withdrawn" })]
    state.tables.profiles = [profile(), profile({ id: "u2", email: "bob@example.com" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("excludes internal accounts", async () => {
    state.tables.user_consents = [consent(), consent({ user_id: "u2" })]
    state.tables.profiles = [profile({ email: "asaf@nodaro.ai" }), profile({ id: "u2", email: "x@example.com", role: "admin" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe("pollWelcomeOffer — dismissed", () => {
  it("posts a dismiss with the time since signup when no consent was granted", async () => {
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T08:02:00.000Z", created_at: "2026-09-16T08:00:30.000Z", free_grant_state: "unclaimed" })]
    state.tables.user_consents = []
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([":no_entry_sign: Welcome popup dismissed — ada@example.com (app) · 2m after signup"])
  })

  it("does not report a dismiss for a user who granted in the same window (the accept line covers it)", async () => {
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T08:01:00.000Z" })]
    state.tables.user_consents = [consent({ granted_at: "2026-09-16T08:04:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("accepted")
  })

  it("ignores a seen stamp outside the window", async () => {
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T07:30:00.000Z", free_grant_state: "unclaimed" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe("pollWelcomeOffer — opt-outs", () => {
  it("posts a decline and an unsubscribe with one wording each", async () => {
    state.tables.user_consents = [
      consent({ user_id: "u1", status: "declined", granted_at: null, declined_at: "2026-09-16T08:01:00.000Z" }),
      consent({ user_id: "u2", status: "withdrawn", granted_at: null, withdrawn_at: "2026-09-16T08:02:00.000Z" }),
    ]
    state.tables.profiles = [profile(), profile({ id: "u2", email: "bob@example.com" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([
      ":no_entry_sign: Marketing emails declined — ada@example.com",
      ":leftwards_arrow_with_hook: Unsubscribed from marketing emails — bob@example.com",
    ])
  })

  it("does not report a withdrawal stamp whose row has since been re-granted", async () => {
    state.tables.user_consents = [consent({ status: "granted", granted_at: "2026-09-16T07:00:00.000Z", withdrawn_at: "2026-09-16T08:02:00.000Z" })]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe("digest helpers", () => {
  it("welcomeLabel covers the four states", () => {
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "granted" }, consent() as never)).toBe("accepted")
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "withheld" }, consent() as never)).toBe("accepted, withheld")
    expect(welcomeLabel({ welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" }, undefined)).toBe("dismissed")
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "unclaimed" }, undefined)).toBe("not shown")
  })

  it("welcomeLabelsFor maps every id it can find and skips unknown ones", async () => {
    state.tables.profiles = [profile(), profile({ id: "u2", welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" })]
    state.tables.user_consents = [consent()]
    const m = await welcomeLabelsFor(["u1", "u2", "u3"])
    expect(m.get("u1")).toBe("accepted")
    expect(m.get("u2")).toBe("dismissed")
    expect(m.has("u3")).toBe(false)
  })

  it("countSubscribed returns the count, and '?' on error", async () => {
    state.counts.user_consents = { count: 15, error: null }
    expect(await countSubscribed()).toBe("15")
    state.counts.user_consents = { count: null, error: { message: "boom" } }
    expect(await countSubscribed()).toBe("?")
  })
})
