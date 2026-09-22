/**
 * A Telegram trigger is only real once the bot has been told where to
 * deliver, and a bot has exactly ONE address. These pin the consequences:
 * the second trigger on a bot joins the url that is already live instead of
 * stealing it, the url outlives the row that held it while other triggers
 * remain, and the bot is taken down only when the last one goes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockRegister, mockUnregister, mockPublish, mockDrop, publicUrl } = vi.hoisted(() => ({
  mockRegister: vi.fn(async () => undefined),
  mockUnregister: vi.fn(async () => undefined),
  mockPublish: vi.fn(),
  mockDrop: vi.fn(),
  publicUrl: { value: "https://app.example.test" },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { get PUBLIC_URL() { return publicUrl.value } },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/services/social/encryption.js", () => ({ decryptToken: (v: string) => `bot:${v}` }))
vi.mock("@/lib/telegram-router.js", () => ({
  generateWebhookToken: () => "minted-token",
  registerTelegramWebhook: mockRegister,
  unregisterTelegramWebhook: mockUnregister,
  publishBotRoutes: mockPublish,
  dropRoute: mockDrop,
  secretOfRow: (row: { config?: Record<string, unknown> | null }) =>
    typeof row.config?.secretToken === "string" ? row.config.secretToken : "",
}))

import { ensureBotRegistration, syncBotRegistration, TelegramActivationError } from "../telegram-trigger-activation.js"
import { supabase } from "../supabase.js"

const USER = "00000000-0000-4000-8000-0000000000ff"
const CONN = "00000000-0000-4000-8000-00000000000c"

const row = (id: string, token: string | null, secret = "shh") => ({
  id,
  workflow_id: "wf-1",
  user_id: USER,
  config: { connectionId: CONN, secretToken: secret },
  webhook_token: token,
})

/**
 * `social_connections` answers one row (or none), `workflow_triggers` answers
 * `triggers` to a list read and records every update.
 */
function tables(opts: {
  connection?: { access_token_encrypted: string } | null
  triggers?: Array<Record<string, unknown>>
}) {
  const updates: Array<Record<string, unknown>> = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain)
    if (table === "social_connections") {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.connection ?? null, error: null }))
      return chain
    }
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch)
      return chain
    })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: opts.triggers ?? [], error: null })
    return chain
  }) as never)
  return { updates }
}

beforeEach(() => vi.clearAllMocks())

describe("ensureBotRegistration", () => {
  it("registers the bot when it has no live url, and hands the token back to store", async () => {
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [] })
    const reg = await ensureBotRegistration({ userId: USER, connectionId: CONN })
    expect(reg).toEqual({ webhookToken: "minted-token", secretToken: "minted-token" })
    expect(mockRegister).toHaveBeenCalledWith("bot:enc", "minted-token", "minted-token", "https://app.example.test")
  })

  it("JOINS the url a sibling already holds — a second trigger must not steal the bot", async () => {
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [row("t1", "live-token", "live-secret")] })
    const reg = await ensureBotRegistration({ userId: USER, connectionId: CONN })
    // No token of its own (the column is UNIQUE) and no call to Telegram.
    expect(reg).toEqual({ webhookToken: null, secretToken: "live-secret" })
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it("registers when the bot's rows hold no url at all (a handover that never landed)", async () => {
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [row("t1", null)] })
    await ensureBotRegistration({ userId: USER, connectionId: CONN })
    expect(mockRegister).toHaveBeenCalledOnce()
  })

  it("refuses a connection that is not the caller's, by saying it was not found", async () => {
    tables({ connection: null, triggers: [] })
    await expect(ensureBotRegistration({ userId: USER, connectionId: CONN }))
      .rejects.toBeInstanceOf(TelegramActivationError)
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it("refuses with an operator-readable reason when the install has no public address", async () => {
    publicUrl.value = ""
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [] })
    await expect(ensureBotRegistration({ userId: USER, connectionId: CONN }))
      .rejects.toThrow(/PUBLIC_URL/)
    expect(mockRegister).not.toHaveBeenCalled()
    publicUrl.value = "https://app.example.test"
  })
})

describe("syncBotRegistration", () => {
  it("takes the bot down only when its LAST trigger is gone", async () => {
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [] })
    await syncBotRegistration({
      userId: USER,
      connectionId: CONN,
      releasedUrls: [{ token: "live-token", secret: "live-secret" }],
    })
    expect(mockUnregister).toHaveBeenCalledWith("bot:enc")
    expect(mockDrop).toHaveBeenCalledWith("live-token")
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it("hands the url to a survivor rather than re-registering — Telegram already calls it", async () => {
    const { updates } = tables({ connection: { access_token_encrypted: "enc" }, triggers: [row("t2", null)] })
    await syncBotRegistration({
      userId: USER,
      connectionId: CONN,
      releasedUrls: [{ token: "live-token", secret: "live-secret" }],
    })
    // The url is UNIQUE: it must leave the row that still holds it (a row
    // deactivated rather than deleted keeps its token) BEFORE the heir can
    // take it, or the index rejects the handover and the bot goes dark.
    expect(updates).toEqual([
      { webhook_token: null },
      {
        webhook_token: "live-token",
        config: { connectionId: CONN, secretToken: "live-secret" },
      },
    ])
    expect(mockUnregister).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
    // The heir now owns the url, so it is republished rather than dropped.
    expect(mockDrop).not.toHaveBeenCalled()
    expect(mockPublish).toHaveBeenCalledOnce()
    expect(mockPublish.mock.calls[0][0]).toEqual([{ ...row("t2", "live-token", "live-secret") }])
  })

  it("leaves a url alone when a survivor still holds it", async () => {
    const { updates } = tables({ connection: { access_token_encrypted: "enc" }, triggers: [row("t1", "live-token", "live-secret")] })
    await syncBotRegistration({ userId: USER, connectionId: CONN })
    expect(updates).toEqual([])
    expect(mockUnregister).not.toHaveBeenCalled()
    expect(mockPublish).toHaveBeenCalledOnce()
  })

  it("never throws — the rows it follows are already written", async () => {
    vi.mocked(supabase.from).mockImplementation((() => { throw new Error("db down") }) as never)
    await expect(syncBotRegistration({ userId: USER, connectionId: CONN })).resolves.toBeUndefined()
  })
})

describe("ensureBotRegistration — what it will and will not join", () => {
  it("does not join a url that has no secret — the inbound handler fails closed on it, so it is dead", async () => {
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [row("t1", "dead-token", "")] })
    const reg = await ensureBotRegistration({ userId: USER, connectionId: CONN })
    expect(reg).toEqual({ webhookToken: "minted-token", secretToken: "minted-token" })
    expect(mockRegister).toHaveBeenCalledOnce()
  })

  it("turns Telegram's refusal into a reason the user can act on", async () => {
    mockRegister.mockRejectedValueOnce(new Error("setWebhook failed: bad webhook: HTTPS url must be provided"))
    tables({ connection: { access_token_encrypted: "enc" }, triggers: [] })
    await expect(ensureBotRegistration({ userId: USER, connectionId: CONN }))
      .rejects.toMatchObject({ name: "TelegramActivationError", message: "Telegram refused the webhook: bad webhook: HTTPS url must be provided" })
  })
})
