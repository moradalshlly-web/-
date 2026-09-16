import { supabase } from "../../lib/supabase.js"
import { KIE_CREDIT_USD } from "../../providers/kie/models.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import type { SlackMessage } from "./slack-client.js"
import { israelParts, startOfIsraelDayUtc } from "./israel-time.js"
import { sectionBlocks } from "./slack-blocks.js"

/**
 * Stream E — the daily credits digest.
 *
 * Once a day (the same Israel hour as the signup digest) one Slack message:
 *   - every user who was charged credits yesterday, with the credits and
 *     what those runs cost US in USD, sorted by credits, plus the totals;
 *   - the KIE.ai balance movement over the same day, read from the hourly
 *     balance snapshots: what burned, what was topped up (the auto-recharge
 *     purchases), and where the balance stands.
 *
 * "Charged" means a `usage_logs` row whose reservation was COMMITTED — the
 * ledger of what users actually paid, refunds excluded. Rows are bucketed by
 * their reservation time (`created_at`; commit stamps no time of its own), so
 * a run reserved at 23:50 and finished after midnight counts with the day it
 * started. A row still `reserved` at send time (a long pipeline) is reported
 * as "in flight" rather than counted; it is not picked up tomorrow either, so
 * the line exists to make that small under-count visible.
 *
 * USD per row prefers `jobs.provider_cost` (USD, what the worker recorded at
 * completion — for KIE derived from the real `credits_consumed`) and falls back to the
 * reservation's estimate (`usage_logs.cost_usd`). Neither is complete:
 * pipelines reserve at $0, a few handlers write no provider cost, and the
 * Workflow Copilot keeps its spend on `copilot_turns`. That is why the footer
 * shows the tracked per-run sum NEXT TO the KIE balance drop instead of
 * pretending they agree — the gap is the untracked part.
 *
 * Only KIE.ai has a balance feed. ElevenLabs, HeyGen, Replicate and the direct
 * LLM lanes are invoiced elsewhere; their cost appears only through the
 * per-run figures.
 */

const PAGE = 1000
/** Ids per `.in()` list. 500 UUIDs is ~20 KB of URL — past what the gateway
 *  reliably accepts (deployment-billing.ts learned this the hard way). */
const IN_CHUNK = 200
/** Per-user lines shown before the rest folds into one "…and N more" line. */
export const CREDITS_DIGEST_MAX_USERS = 40
const INTERNAL_EMAIL_SUFFIX = "@nodaro.ai"

export interface UsageLogRow {
  user_id: string
  job_id: string | null
  status: "reserved" | "committed" | string | null
  credits_charged: number | string | null
  credits_used: number | string | null
  cost_usd: number | string | null
}

export interface UserSpend {
  userId: string
  credits: number
  usd: number
  runs: number
}

export interface UsageAggregate {
  perUser: UserSpend[] // sorted by credits desc, then usd desc
  totalCredits: number
  totalUsd: number
  runs: number
  /** Reservations from the day that had not settled at send time. */
  inFlightCredits: number
  inFlightRuns: number
}

export interface KieSnapshot {
  credits: number | string
  recorded_at: string
}

export interface KieSpend {
  /** Sum of every hour-to-hour drop, in KIE credits. */
  burnedCredits: number
  /** Sum of every hour-to-hour rise, in KIE credits — the auto-recharge purchases. */
  toppedUpCredits: number
  topUps: number
  /** Latest reading inside the window, or null when there were none. */
  lastBalance: number | null
}

/** DECIMAL columns arrive as strings over PostgREST; a non-numeric or missing
 *  value counts as 0 so one odd row cannot poison the day's sum. */
export function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Pure computation — no DB access, unit-tested directly.
// ---------------------------------------------------------------------------

export function aggregateUsage(rows: UsageLogRow[], providerCostByJob: Map<string, number>): UsageAggregate {
  const byUser = new Map<string, UserSpend>()
  let totalCredits = 0
  let totalUsd = 0
  let inFlightCredits = 0
  let inFlightRuns = 0
  let runs = 0
  for (const row of rows) {
    if (row.status === "reserved") {
      inFlightCredits += num(row.credits_used)
      inFlightRuns += 1
      continue
    }
    if (row.status !== "committed") continue // refunded (or unknown) — the user did not pay
    runs += 1
    const credits = row.credits_charged == null ? num(row.credits_used) : num(row.credits_charged)
    const tracked = row.job_id ? providerCostByJob.get(row.job_id) : undefined
    const usd = tracked ?? num(row.cost_usd)
    const prev = byUser.get(row.user_id) ?? { userId: row.user_id, credits: 0, usd: 0, runs: 0 }
    byUser.set(row.user_id, {
      userId: row.user_id,
      credits: prev.credits + credits,
      usd: prev.usd + usd,
      runs: prev.runs + 1,
    })
    totalCredits += credits
    totalUsd += usd
  }
  const perUser = [...byUser.values()].sort((a, b) => b.credits - a.credits || b.usd - a.usd)
  return { perUser, totalCredits, totalUsd, runs, inFlightCredits, inFlightRuns }
}

/**
 * Balance movement from hourly readings. `baseline` is the last reading BEFORE
 * the window (so the first in-window hour's change is seen too); readings are
 * walked in time order and each delta is classed as a burn or a top-up. A
 * purchase and a burn inside the same hour partly cancel — the readings are
 * hourly, so this is a floor on both, never an overstatement.
 */
export function kieSpendFromSnapshots(baseline: KieSnapshot | null, rows: KieSnapshot[]): KieSpend {
  const ordered = [...rows]
    .map((r) => ({ credits: num(r.credits), at: new Date(r.recorded_at).getTime() }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at)
  let prev = baseline ? num(baseline.credits) : null
  let burnedCredits = 0
  let toppedUpCredits = 0
  let topUps = 0
  for (const r of ordered) {
    if (prev !== null) {
      const delta = r.credits - prev
      if (delta < 0) burnedCredits += -delta
      else if (delta > 0) {
        toppedUpCredits += delta
        topUps += 1
      }
    }
    prev = r.credits
  }
  return {
    burnedCredits,
    toppedUpCredits,
    topUps,
    lastBalance: ordered.length > 0 ? ordered[ordered.length - 1].credits : null,
  }
}

export function kieCreditsToUsd(credits: number): number {
  return credits * KIE_CREDIT_USD
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US")
const fmtUsd = (n: number): string => `$${n.toFixed(2)}`

export interface DigestIdentity {
  email: string | null
  internal: boolean
}

export function buildCreditsDigestMessage(
  dateLabel: string,
  usage: UsageAggregate,
  identities: Map<string, DigestIdentity>,
  kie: KieSpend | null,
): SlackMessage {
  const shown = usage.perUser.slice(0, CREDITS_DIGEST_MAX_USERS)
  const rest = usage.perUser.slice(CREDITS_DIGEST_MAX_USERS)
  const lines = shown.map((u) => {
    const id = identities.get(u.userId)
    const who = id?.email ?? u.userId
    const tag = id?.internal ? " (internal)" : ""
    return `• ${who}${tag} — *${fmtInt(u.credits)}* cr — ${fmtUsd(u.usd)} · ${u.runs} run${u.runs === 1 ? "" : "s"}`
  })
  if (rest.length > 0) {
    const credits = rest.reduce((n, u) => n + u.credits, 0)
    const usd = rest.reduce((n, u) => n + u.usd, 0)
    lines.push(`…and ${rest.length} more users — ${fmtInt(credits)} cr — ${fmtUsd(usd)}`)
  }
  if (lines.length === 0) lines.push("_No credits were charged._")

  const headline = `Credits ${dateLabel}: ${fmtInt(usage.totalCredits)} cr · cost to us ${fmtUsd(usage.totalUsd)}`
  const footer: string[] = []
  if (usage.inFlightRuns > 0) {
    footer.push(
      `${usage.inFlightRuns} run${usage.inFlightRuns === 1 ? "" : "s"} from that day still in flight ` +
        `(${fmtInt(usage.inFlightCredits)} cr reserved, not counted above).`,
    )
  }
  footer.push(kieFooter(usage.totalUsd, kie))
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: headline } },
    ...sectionBlocks(lines),
    { type: "context", elements: [{ type: "mrkdwn", text: footer.join("\n") }] },
  ]
  return { text: headline, blocks }
}

function kieFooter(trackedUsd: number, kie: KieSpend | null): string {
  const otherProviders =
    "ElevenLabs, HeyGen, Replicate and the direct LLM lanes have no balance feed — their cost is only in the per-run $ above."
  if (!kie || kie.lastBalance === null) {
    return `*KIE.ai:* no balance readings for this day. ${otherProviders}`
  }
  const burned = kieCreditsToUsd(kie.burnedCredits)
  const topped = kieCreditsToUsd(kie.toppedUpCredits)
  const balance = kie.lastBalance
  const topUpText =
    kie.topUps > 0 ? `topped up *${fmtUsd(topped)}* (${kie.topUps} purchase${kie.topUps === 1 ? "" : "s"})` : "no top-ups"
  return (
    `*KIE.ai* (from hourly balance readings): burned *${fmtUsd(burned)}* · ${topUpText} · ` +
    `balance ${fmtInt(balance)} cr ≈ ${fmtUsd(kieCreditsToUsd(balance))}. ` +
    `Tracked per-run cost ${fmtUsd(trackedUsd)} vs balance drop ${fmtUsd(burned)}. ${otherProviders}`
  )
}

// ---------------------------------------------------------------------------
// Data access.
// ---------------------------------------------------------------------------

/** Every non-refunded usage row reserved inside [from, to) — committed rows
 *  are the charge, reserved rows are the in-flight tally. Paged: PostgREST
 *  caps a query at 1000 rows and says nothing about it. */
async function unrefundedUsageRows(fromIso: string, toIso: string): Promise<UsageLogRow[]> {
  const rows: UsageLogRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("user_id, job_id, status, credits_charged, credits_used, cost_usd")
      .neq("status", "refunded")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }) // tiebreak: equal timestamps across a page boundary must not skip/duplicate
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as UsageLogRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/** Best-effort enrichment: a failed chunk leaves those rows on the reservation
 *  estimate (the documented fallback) instead of suppressing the whole digest. */
async function providerCostsFor(jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
    const chunk = jobIds.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase.from("jobs").select("id, provider_cost").in("id", chunk)
    if (error) {
      console.error("[notify] credits digest: provider_cost chunk failed, using reservation estimates:", error.message)
      continue
    }
    for (const j of (data ?? []) as Array<{ id: string; provider_cost: number | string | null }>) {
      if (j.provider_cost != null) out.set(j.id, num(j.provider_cost))
    }
  }
  return out
}

async function identitiesFor(userIds: string[]): Promise<Map<string, DigestIdentity>> {
  const out = new Map<string, DigestIdentity>()
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const chunk = userIds.slice(i, i + IN_CHUNK)
    const { data } = await supabase.from("profiles").select("id, email, role").in("id", chunk)
    for (const p of (data ?? []) as Array<{ id: string; email: string | null; role: string | null }>) {
      const internal = (p.role != null && p.role !== "user") || (p.email?.toLowerCase().endsWith(INTERNAL_EMAIL_SUFFIX) ?? false)
      out.set(p.id, { email: p.email, internal })
    }
  }
  return out
}

/** Readings inside the window plus the last one before it (the baseline). */
async function kieSpendFor(fromIso: string, toIso: string): Promise<KieSpend | null> {
  try {
    const [{ data: inWindow, error }, { data: before, error: baselineError }] = await Promise.all([
      supabase
        .from("kie_credit_snapshots")
        .select("credits, recorded_at")
        .gte("recorded_at", fromIso)
        .lt("recorded_at", toIso)
        .order("recorded_at", { ascending: true }),
      supabase
        .from("kie_credit_snapshots")
        .select("credits, recorded_at")
        .lt("recorded_at", fromIso)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ])
    // A failed baseline read would silently drop the first hour's movement
    // (a whole top-up, possibly) — say "no readings" instead of a wrong number.
    if (error || baselineError) return null
    const baseline = ((before ?? []) as KieSnapshot[])[0] ?? null
    return kieSpendFromSnapshots(baseline, (inWindow ?? []) as KieSnapshot[])
  } catch {
    return null // the credits half still sends; the footer says there were no readings
  }
}

// ---------------------------------------------------------------------------
// The tick entry. Same gate as the signup digest: first tick where the Israel
// hour == digestHour and today's date is not yet marked sent. Sends on a
// zero-credit day too — on a live product that is signal. The date is marked
// only after a successful post, so a Slack failure retries on the next tick.
// ---------------------------------------------------------------------------
export async function maybeSendCreditsDigest(
  now: Date,
  enabled: boolean,
  digestHour: number,
  post: (msg: SlackMessage) => Promise<boolean>,
): Promise<void> {
  if (!enabled) return
  try {
    const { date: today, hour } = israelParts(now)
    if (hour !== digestHour) return
    if ((await readNotifyState("notify_last_credits_digest_date")) === today) return

    const todayStart = startOfIsraelDayUtc(now)
    const yesterdayStart = startOfIsraelDayUtc(new Date(todayStart.getTime() - 60_000))
    const fromIso = yesterdayStart.toISOString()
    const toIso = todayStart.toISOString()
    const dateLabel = israelParts(yesterdayStart).date

    const rows = await unrefundedUsageRows(fromIso, toIso)
    const jobIds = Array.from(
      new Set(rows.filter((r) => r.status === "committed").map((r) => r.job_id).filter((id): id is string => Boolean(id))),
    )
    const [providerCosts, kie] = await Promise.all([providerCostsFor(jobIds), kieSpendFor(fromIso, toIso)])
    const usage = aggregateUsage(rows, providerCosts)
    const identities = await identitiesFor(usage.perUser.map((u) => u.userId))

    const ok = await post(buildCreditsDigestMessage(dateLabel, usage, identities, kie))
    if (ok) await writeNotifyState("notify_last_credits_digest_date", today)
  } catch (err) {
    // Best-effort — the next tick tries again. Logged, unlike the event
    // streams: this stream's absence looks exactly like a quiet day.
    console.error("[notify] credits digest failed:", err)
  }
}
