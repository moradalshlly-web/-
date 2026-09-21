import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { allowanceEnforcementActive, deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { externalWalletConfig, ExternalWalletError, readWalletBalance, reserveWallet, settleWallet, walletCredits } from "./external-wallet-client.js"

const operationSchema = z.object({
  usage_log_id: z.string().uuid(), requester_id: z.string().uuid(), job_id: z.string().uuid().nullable(),
  provider: z.string().min(1), sso_subject: z.string().min(1), model_identifier: z.string(),
  reserved_credits: walletCredits.positive(), authorized_at: z.string().nullable(),
  actual_credits: walletCredits.nullable(), attempts: z.number().int().nonnegative(),
})

export function validateExternalWallet(): ReturnType<typeof externalWalletConfig> {
  const config = externalWalletConfig()
  if (config && (!deploymentPayerActive() || allowanceEnforcementActive())) {
    throw new Error("External wallet requires a deployment payer and billing.allowances=off")
  }
  return config
}

export function externalWalletActive(): boolean { return externalWalletConfig() !== null }

/** Called by EVERY reservation lane, before a usage ID can reach a provider. */
export async function authorizeExternalReservation(usageLogId: string, userId: string): Promise<void> {
  const config = validateExternalWallet()
  if (!config) return
  try {
    const { data, error } = await supabase.rpc("prepare_external_wallet", {
      p_usage_log_id: usageLogId, p_user_id: userId, p_payer_id: deploymentPayerId(), p_provider: config.provider,
    })
    const parsed = operationSchema.safeParse(data)
    if (error || !parsed.success || parsed.data.usage_log_id !== usageLogId || parsed.data.requester_id !== userId
      || parsed.data.provider !== config.provider || parsed.data.actual_credits !== null) throw new ExternalWalletError("external_wallet_unavailable")
    if (parsed.data.authorized_at) return
    await reserveWallet(config, parsed.data)
    const acknowledged = await supabase.rpc("authorize_external_wallet", { p_usage_log_id: usageLogId })
    if (acknowledged.error || acknowledged.data !== true) throw new ExternalWalletError("external_wallet_unavailable")
  } catch (error) {
    // Also handles a lost prepare/authorize response. SQL locks the usage row;
    // a timeout cannot cancel another caller's already authorized reservation.
    const aborted = await supabase.rpc("abort_external_wallet", { p_usage_log_id: usageLogId })
    if (!aborted.error && aborted.data === true) return
    if (aborted.error) console.error("[external-wallet] reservation cancellation needs recovery", { usageLogId })
    void deliverExternalWalletSettlements(usageLogId)
    throw error instanceof ExternalWalletError ? error : new ExternalWalletError("external_wallet_unavailable")
  }
}

/** Unknown is null. Never fall back to a frozen local allowance/personal grant. */
export async function externalWalletBalance(userId: string): Promise<number | null> {
  const config = validateExternalWallet()
  if (!config) return null
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    const metadata = data.user?.app_metadata
    if (error || metadata?.sso !== config.provider || typeof metadata.sso_subject !== "string" || !metadata.sso_subject) return null
    return await readWalletBalance(config, userId, metadata.sso_subject)
  } catch { return null }
}

/** At-least-once delivery. The remote contract deduplicates even across replicas. */
export async function deliverExternalWalletSettlements(usageLogId?: string): Promise<void> {
  const config = externalWalletConfig()
  if (!config) return
  try {
    let query = supabase.from("external_wallet_operations").select("*")
      .is("delivered_at", null).not("actual_credits", "is", null).eq("provider", config.provider)
    if (usageLogId) query = query.eq("usage_log_id", usageLogId)
    else query = query.lte("next_attempt_at", new Date().toISOString())
    const { data, error } = await query.order("next_attempt_at").limit(25)
    if (error) throw new Error("outbox unavailable")
    const rows = z.array(operationSchema).parse(data ?? [])
    // Five concurrent deliveries bound both network load and one cron's lifetime.
    for (let offset = 0; offset < rows.length; offset += 5) {
      await Promise.all(rows.slice(offset, offset + 5).map(async row => {
        try {
          await settleWallet(config, row, row.actual_credits!)
          const saved = await supabase.from("external_wallet_operations").update({ delivered_at: new Date().toISOString() })
            .eq("usage_log_id", row.usage_log_id).eq("actual_credits", row.actual_credits!)
          if (saved.error) throw new Error("acknowledgment unavailable")
        } catch {
          const delay = Math.min(3600, 15 * 2 ** Math.min(row.attempts, 8))
          await supabase.from("external_wallet_operations").update({ attempts: row.attempts + 1,
            next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() }).eq("usage_log_id", row.usage_log_id).is("delivered_at", null)
          console.warn("[external-wallet] settlement queued for retry", { usageLogId: row.usage_log_id })
        }
      }))
    }
  } catch { console.error("[external-wallet] settlement outbox could not be read") }
}

let reconciling = false
export async function reconcileExternalWallet(): Promise<void> {
  const config = externalWalletConfig()
  if (!config || reconciling) return
  reconciling = true
  try {
    // A provider can only run after authorized_at is durable. Unknown reserves
    // left by a crashed process can therefore safely become terminal releases.
    const { data, error } = await supabase.from("external_wallet_operations").select("usage_log_id")
      .eq("provider", config.provider).is("authorized_at", null).is("actual_credits", null)
      .lt("created_at", new Date(Date.now() - 120000).toISOString()).limit(100)
    if (error) throw new Error("recovery unavailable")
    for (const row of data ?? []) {
      const aborted = await supabase.rpc("abort_external_wallet", { p_usage_log_id: row.usage_log_id })
      if (aborted.error) console.error("[external-wallet] orphan cancellation needs retry", { usageLogId: row.usage_log_id })
    }
    await deliverExternalWalletSettlements()
  } catch { console.error("[external-wallet] recovery failed; will retry") }
  finally { reconciling = false }
}
