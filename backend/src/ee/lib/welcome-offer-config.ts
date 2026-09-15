import { supabase } from "../../lib/supabase.js"

/**
 * The welcome-credits opt-in switch. One `app_settings` row,
 * `welcome_offer_enabled`, read with a 60s cache — the same shape as
 * `consent-config.ts`, and dormant for the same reason.
 *
 * OFF (the default) means today's behaviour exactly: the signup grant is
 * claimed automatically, no popup, no banner, no creation block, and the
 * claim RPC is called with its pre-426 arguments. Staging shares the
 * production database and a dev deploy runs ahead of migration 426 landing on
 * main; the flag is what keeps that window safe. An admin turns it on after
 * the promotion.
 */
export interface WelcomeOfferConfig {
  /** Master on/off. False = the grant is unconditional and no surface shows. */
  enabled: boolean
}

export const WELCOME_OFFER_CONFIG_DEFAULTS: WelcomeOfferConfig = { enabled: false }

export const WELCOME_OFFER_ENABLED_KEY = "welcome_offer_enabled"

const CACHE_TTL_MS = 60_000
/** After a failed read, retry this soon rather than sitting on the fallback. */
const ERROR_RETRY_MS = 5_000
let cached: WelcomeOfferConfig | null = null
let cachedAt = 0
let inflight: Promise<WelcomeOfferConfig> | null = null

export async function getWelcomeOfferConfig(): Promise<WelcomeOfferConfig> {
  const now = Date.now()
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = refresh()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

type FlagRead = { ok: true; enabled: boolean } | { ok: false }

/** A missing row is a real answer (off); a PostgREST error or a throw is not. */
async function readFlag(): Promise<FlagRead> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("key", WELCOME_OFFER_ENABLED_KEY)
      .maybeSingle()
    if (error) return { ok: false }
    const value = (data as { value?: unknown } | null)?.value
    return { ok: true, enabled: value === true }
  } catch {
    return { ok: false }
  }
}

async function refresh(): Promise<WelcomeOfferConfig> {
  const read = await readFlag()
  if (read.ok) {
    cached = { enabled: read.enabled }
    cachedAt = Date.now()
    return cached
  }
  // A transient read error must not flip the gate: with the offer ON, one
  // blip answering "off" for a minute would mint credits without consent and
  // lift the creation block. Keep the last good answer and retry soon; only a
  // cold cache falls back to OFF (dormant, never a 500 on the reads that
  // consult it).
  const fallback = cached ?? { ...WELCOME_OFFER_CONFIG_DEFAULTS }
  cached = fallback
  cachedAt = Date.now() - CACHE_TTL_MS + ERROR_RETRY_MS
  return fallback
}

/** Tests and the admin write path: forget the cached row. */
export function invalidateWelcomeOfferConfigCache(): void {
  cached = null
  cachedAt = 0
}
