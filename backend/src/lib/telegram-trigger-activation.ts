/**
 * What makes a Telegram trigger row REAL.
 *
 * A schedule is armed by its row (the cron polls the table) and a webhook by
 * its token (the caller brings the url). A Telegram trigger is neither: until
 * `setWebhook` has told Telegram where to deliver, the row is a lie. So the
 * registration happens BEFORE the row is written, and a row is never created
 * for a bot Telegram could not be pointed at.
 *
 * The other half is that a bot has exactly ONE url. Minting a fresh one per
 * trigger silently un-subscribes every earlier trigger on the same bot, so a
 * second trigger JOINS the url that is already live instead: it stores no
 * token of its own (`webhook_token` is UNIQUE anyway) and rides the bot's
 * registration, and the inbound handler fans the update out to every trigger
 * on that bot. When the row that HOLDS the url goes away while others remain,
 * the url is handed to a survivor rather than re-registered — Telegram is
 * already calling it, so there is nothing to tell it.
 */
import { config } from "./config.js"
import { supabase } from "./supabase.js"
import { decryptToken } from "../services/social/encryption.js"
import {
  dropRoute,
  generateWebhookToken,
  publishBotRoutes,
  registerTelegramWebhook,
  secretOfRow,
  unregisterTelegramWebhook,
  type TriggerRow,
} from "./telegram-router.js"

const TRIGGER_COLUMNS = "id, workflow_id, user_id, config, webhook_token"

/** A reason the user can act on — it reaches them as the failed-sync toast. */
export class TelegramActivationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TelegramActivationError"
  }
}

function publicBaseUrl(): string {
  const url = config.PUBLIC_URL.trim().replace(/\/+$/, "")
  if (!url) {
    throw new TelegramActivationError(
      "PUBLIC_URL is not configured, so Telegram has no address to deliver to",
    )
  }
  return url
}

/** The bot behind a connection THIS user owns — never one named by a graph
 *  someone else wrote. */
async function botTokenFor(userId: string, connectionId: string): Promise<string> {
  const { data: conn } = await supabase
    .from("social_connections")
    .select("access_token_encrypted")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("platform", "telegram")
    .maybeSingle()

  const encrypted = conn?.access_token_encrypted
  if (typeof encrypted !== "string" || !encrypted) {
    throw new TelegramActivationError("That Telegram bot connection was not found")
  }
  try {
    return decryptToken(encrypted)
  } catch {
    throw new TelegramActivationError("That Telegram bot credential could not be read")
  }
}

async function activeRowsForBot(userId: string, connectionId: string): Promise<TriggerRow[]> {
  const { data } = await supabase
    .from("workflow_triggers")
    .select(TRIGGER_COLUMNS)
    .eq("user_id", userId)
    .eq("type", "telegram")
    .eq("is_active", true)
    .eq("config->>connectionId", connectionId)
  return (data ?? []) as TriggerRow[]
}

export interface BotRegistration {
  /** The url to store on the new row, or null when it rides one already live. */
  readonly webhookToken: string | null
  readonly secretToken: string
}

/**
 * The url this bot is reachable at, registering one if it has none. Throws
 * (with a user-readable reason) rather than returning a registration Telegram
 * does not know about.
 */
export async function ensureBotRegistration(params: {
  readonly userId: string
  readonly connectionId: string
}): Promise<BotRegistration> {
  const { userId, connectionId } = params
  // A url is only worth joining when it can be answered: the inbound handler
  // fails CLOSED on a url with no secret, so a legacy row that holds a token
  // but no secret is dead, and a new trigger must not inherit that.
  const live = (await activeRowsForBot(userId, connectionId)).find((r) => r.webhook_token && secretOfRow(r))
  if (live?.webhook_token) return { webhookToken: null, secretToken: secretOfRow(live) }

  const publicUrl = publicBaseUrl()
  const botToken = await botTokenFor(userId, connectionId)
  const webhookToken = generateWebhookToken()
  const secretToken = generateWebhookToken()
  try {
    await registerTelegramWebhook(botToken, webhookToken, secretToken, publicUrl)
  } catch (err) {
    // Telegram's own description ("bad webhook: HTTPS url must be provided",
    // "Unauthorized") is about the user's bot and address — theirs to act on.
    const detail = err instanceof Error ? err.message.replace(/^setWebhook failed: /, "") : String(err)
    throw new TelegramActivationError(`Telegram refused the webhook: ${detail}`)
  }
  return { webhookToken, secretToken }
}

/** A url whose row was just removed or deactivated. */
export interface ReleasedUrl {
  readonly token: string
  readonly secret: string
}

/**
 * Bring Telegram and the routing cache back in line with the rows, after a
 * create, an edit or a removal. Best-effort by construction: the rows are
 * already written, and a hiccup here must not undo a save that succeeded.
 */
export async function syncBotRegistration(params: {
  readonly userId: string
  readonly connectionId: string
  readonly releasedUrls?: readonly ReleasedUrl[]
}): Promise<void> {
  const { userId, connectionId } = params
  const released = params.releasedUrls ?? []
  try {
    const rows = await activeRowsForBot(userId, connectionId)

    if (rows.length === 0) {
      for (const r of released) dropRoute(r.token)
      try {
        await unregisterTelegramWebhook(await botTokenFor(userId, connectionId))
      } catch {
        // The bot may already be disconnected; nothing left to take down.
      }
      return
    }

    // The bot's url outlives the row that held it: hand it to a survivor so
    // the deliveries Telegram is already making keep landing.
    const heirless = !rows.some((r) => r.webhook_token)
    const inherited = heirless ? released.find((r) => r.token) : undefined
    let current = rows
    if (inherited) {
      // `webhook_token` is UNIQUE, so the url has to LEAVE whatever row still
      // holds it before an heir can take it. A row that was deactivated
      // rather than deleted keeps its token, and the index would reject the
      // handover — silently, since this function swallows. Clearing it here
      // rather than trusting each caller to means a deactivation lane added
      // later cannot reintroduce that.
      await supabase
        .from("workflow_triggers")
        .update({ webhook_token: null })
        .eq("user_id", userId)
        .eq("webhook_token", inherited.token)

      const heir = rows[0]
      const heirConfig = { ...(heir.config ?? {}), secretToken: inherited.secret }
      const { error } = await supabase
        .from("workflow_triggers")
        .update({ webhook_token: inherited.token, config: heirConfig })
        .eq("id", heir.id)
        .eq("user_id", userId)
      if (!error) {
        current = [{ ...heir, webhook_token: inherited.token, config: heirConfig }, ...rows.slice(1)]
      }
    }

    for (const r of released) {
      if (!current.some((row) => row.webhook_token === r.token)) dropRoute(r.token)
    }
    publishBotRoutes(current)
  } catch {
    // Never throws: the caller's write already landed.
  }
}
