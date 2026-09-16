import { supabase } from "../../lib/supabase.js"
import { findContact, isLoopsConfigured } from "../lib/loops-client.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import { israelParts } from "./israel-time.js"

/**
 * Daily Loops unsubscribe pull.
 *
 * Our consent sync is one-way: we push to Loops, Loops tells nobody. So an
 * unsubscribe made from the link INSIDE a marketing email exists only in
 * Loops, while our `user_consents` row keeps saying `granted`, the digest
 * keeps counting the person, and no alert can fire. Once a day this asks
 * Loops about every granted contact and mirrors a "no" back into the row —
 * `status = withdrawn`, `withdrawn_at = now` — which is exactly what the
 * Settings toggle writes, so stream D reports it on its next tick with the
 * same "Unsubscribed" line and the "subscribed to email" total stays honest.
 *
 * A contact Loops no longer has at all (deleted there) is treated the same
 * way: whatever the reason, that person is not on the list.
 *
 * Cadence: once per Israel day, on the first tick at or after the digest
 * hour (a missed hour is caught on the next tick, not skipped to tomorrow).
 * `loops_dirty` stays false on the write — Loops is the source of this
 * change; there is nothing to push back.
 */

const CONSENT_KIND = "marketing_email"
const PAGE = 1000

interface GrantedRow {
  user_id: string
}

interface ProfileEmail {
  id: string
  email: string | null
}

export interface LoopsPullSummary {
  checked: number
  withdrawn: number
  missing: number
  errors: number
}

export function isLoopsPullDue(now: Date, digestHour: number, lastPullDate: string | null): boolean {
  const { date, hour } = israelParts(now)
  return hour >= digestHour && lastPullDate !== date
}

export async function pullLoopsUnsubscribes(now: Date, enabled: boolean, digestHour: number): Promise<LoopsPullSummary | null> {
  if (!enabled || !isLoopsConfigured()) return null
  try {
    const last = await readNotifyState("notify_last_loops_pull_date")
    if (!isLoopsPullDue(now, digestHour, last)) return null
    // Claim the day BEFORE the (minutes-long) walk over the contacts, so the
    // 5-minute tick can never start a second walk beside a slow one. A walk
    // that dies midway is caught up tomorrow — every row it missed is still
    // `granted` and still asked then.
    await writeNotifyState("notify_last_loops_pull_date", israelParts(now).date)
    return await reconcileGrantedAgainstLoops(now)
  } catch {
    return null // best-effort; tomorrow's tick tries again
  }
}

async function grantedUserIds(): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_consents")
      .select("user_id")
      .eq("kind", CONSENT_KIND)
      .eq("status", "granted")
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as GrantedRow[]
    ids.push(...rows.map((r) => r.user_id))
    if (rows.length < PAGE) break
  }
  return ids
}

async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE)
    const { data } = await supabase.from("profiles").select("id, email").in("id", chunk)
    for (const p of (data ?? []) as ProfileEmail[]) if (p.email) out.set(p.id, p.email)
  }
  return out
}

async function markWithdrawn(userId: string, nowIso: string): Promise<boolean> {
  // CAS on `granted`: a re-grant that raced this pull wins and is not undone.
  const { error } = await supabase
    .from("user_consents")
    .update({ status: "withdrawn", withdrawn_at: nowIso, loops_dirty: false, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("kind", CONSENT_KIND)
    .eq("status", "granted")
  return !error
}

async function reconcileGrantedAgainstLoops(now: Date): Promise<LoopsPullSummary> {
  const nowIso = now.toISOString()
  const summary: LoopsPullSummary = { checked: 0, withdrawn: 0, missing: 0, errors: 0 }
  const ids = await grantedUserIds()
  const emails = await emailsFor(ids)
  for (const id of ids) {
    const email = emails.get(id)
    if (!email) continue
    const r = await findContact(email)
    if (!r.ok) {
      summary.errors += 1 // unknown — leave the row alone until tomorrow
      continue
    }
    summary.checked += 1
    if (r.contact === null) {
      if (await markWithdrawn(id, nowIso)) summary.missing += 1
      continue
    }
    if (!r.contact.subscribed) {
      if (await markWithdrawn(id, nowIso)) summary.withdrawn += 1
    }
  }
  return summary
}
