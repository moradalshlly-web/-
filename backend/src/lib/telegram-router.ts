import { randomBytes } from "node:crypto"
import { supabase } from "./supabase.js"

/**
 * Where an inbound Telegram update goes.
 *
 * A bot delivers to exactly ONE url, so the url's token — not the trigger —
 * is what Telegram knows, and every ACTIVE trigger on that bot has to be
 * reachable through it. Hence `token -> { secretToken, triggers[] }`: one
 * secret per url (the one that was handed to `setWebhook` with it), and a
 * fan-out to every trigger listening on that bot, each with its own filters.
 *
 * Rows written before triggers shared a registration carry a token each, and
 * only the last-registered one is live at Telegram. A bot's whole trigger
 * list is therefore published under EVERY token its rows carry: whichever url
 * Telegram still calls, all of that bot's triggers fire, and the secret
 * checked is the one that url was registered with.
 *
 * The table is a CACHE of `workflow_triggers`, rebuilt from it at boot and
 * republished from it after every write (`lib/telegram-trigger-activation.ts`).
 * It is per-process: a second API replica only learns of a registration at its
 * own boot. Closing that is the follow-up this file is waiting for — resolve
 * the token straight from the row (`webhook_token` is UNIQUE and indexed), the
 * way the generic webhook lane already does.
 */
export interface TriggerEntry {
  readonly triggerId: string
  readonly workflowId: string
  readonly userId: string
  /** Which bot delivered this — the one whose token downloads its media. */
  readonly connectionId?: string
  /**
   * The graph node this row was projected from (`config.nodeId`). It rides
   * the run as `triggerNodeId`, so the worker executes the branch behind THAT
   * node (`triggerRunScope`) — with two Telegram Triggers on one canvas each
   * runs its own branch instead of both running the whole workflow. A row
   * made through the API names none.
   */
  readonly nodeId?: string
  readonly chatIdFilter?: string
  readonly messageTypeFilters?: string[]
}

export interface Route {
  /** The `secret_token` handed to `setWebhook` for THIS url. */
  readonly secretToken: string
  readonly triggers: readonly TriggerEntry[]
}

/** Outbound calls to Telegram run inside a workflow save — never unbounded. */
const TELEGRAM_API_TIMEOUT_MS = 10_000

// In-memory routing table: webhookToken → Route
const routingTable = new Map<string, Route>()

export function getRouteForToken(webhookToken: string): Route | undefined {
  return routingTable.get(webhookToken)
}

export function generateWebhookToken(): string {
  return randomBytes(32).toString("hex")
}

export async function registerTelegramWebhook(
  botToken: string,
  webhookToken: string,
  secretToken: string,
  publicUrl: string,
): Promise<void> {
  const url = `${publicUrl}/v1/telegram/webhook/${webhookToken}`
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
    }),
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  })
  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`setWebhook failed: ${data.description}`)
}

export async function unregisterTelegramWebhook(botToken: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: "POST",
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  })
}

/** A 20 MB download over a slow link needs longer than a control call. */
const TELEGRAM_FILE_TIMEOUT_MS = 60_000

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer | null> {
  const pathRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, {
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  })
  const pathData = await pathRes.json() as { ok: boolean; result?: { file_path: string; file_size?: number } }
  if (!pathData.ok || !pathData.result?.file_path) return null

  if (pathData.result.file_size && pathData.result.file_size > 20 * 1024 * 1024) return null

  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${pathData.result.file_path}`, {
    signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS),
  })
  if (!fileRes.ok) return null
  return Buffer.from(await fileRes.arrayBuffer())
}

/** The shape every publisher reads rows in. */
export interface TriggerRow {
  readonly id: string
  readonly workflow_id: string
  readonly user_id: string
  readonly config: Record<string, unknown> | null
  readonly webhook_token: string | null
}

export function entryFromRow(row: TriggerRow): TriggerEntry {
  const cfg = row.config ?? {}
  const filters = Array.isArray(cfg.messageTypeFilters)
    ? (cfg.messageTypeFilters as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined
  return {
    triggerId: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    connectionId: typeof cfg.connectionId === "string" && cfg.connectionId ? cfg.connectionId : undefined,
    nodeId: typeof cfg.nodeId === "string" && cfg.nodeId ? cfg.nodeId : undefined,
    chatIdFilter: typeof cfg.chatIdFilter === "string" && cfg.chatIdFilter ? cfg.chatIdFilter : undefined,
    messageTypeFilters: filters && filters.length > 0 ? filters : undefined,
  }
}

export function secretOfRow(row: TriggerRow): string {
  const secret = row.config?.secretToken
  return typeof secret === "string" ? secret : ""
}

/**
 * Publish one bot's active triggers. REPLACES what each of its urls pointed
 * at, so a trigger that left the graph stops firing without anyone having to
 * remember to unpublish it.
 */
export function publishBotRoutes(rows: readonly TriggerRow[]): void {
  const entries = rows.map(entryFromRow)
  for (const row of rows) {
    if (!row.webhook_token) continue
    routingTable.set(row.webhook_token, { secretToken: secretOfRow(row), triggers: entries })
  }
}

/** Drop a url entirely — the bot is no longer pointed at us through it. */
export function dropRoute(webhookToken: string | null | undefined): void {
  if (webhookToken) routingTable.delete(webhookToken)
}

/** Which bot a trigger row listens on. Rows predating the connection binding
 *  have none, and are their own group so they keep working alone. */
export function botGroupKey(row: TriggerRow): string {
  const cfg = row.config ?? {}
  return typeof cfg.connectionId === "string" && cfg.connectionId ? `conn:${cfg.connectionId}` : `row:${row.id}`
}

/** Load all active Telegram triggers into the in-memory routing table. Called once at startup. */
export async function initTelegramRoutingTable(): Promise<void> {
  const { data: triggers } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config, webhook_token, is_active")
    .eq("type", "telegram")
    .eq("is_active", true)

  if (!triggers) return

  routingTable.clear()

  const groups = new Map<string, TriggerRow[]>()
  for (const row of triggers as TriggerRow[]) {
    const key = botGroupKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  for (const rows of groups.values()) publishBotRoutes(rows)
}
