/**
 * Workflow trigger sync — the graph is the single source of truth.
 *
 * `schedule-cron.ts` polls `workflow_triggers` rows; it never looks at the
 * workflow graph. Before this module nothing wrote those rows from a save, so
 * a Schedule Trigger node placed in the editor (or written by MCP / import /
 * the SDK) was decorative: the user configured a cron, saved, and nothing was
 * ever scheduled — silently. Same for Webhook Trigger, even though
 * `docs/api-integration.md` promises "Add a Webhook Trigger node. Save it.
 * Nodaro mints a token".
 *
 * So every graph write reconciles: trigger nodes in the graph are projected
 * onto rows, and a node that leaves the graph takes its row with it. Callers
 * run this AFTER the workflow row is persisted, and it never throws — a
 * failure here must not fail a save that already succeeded.
 *
 * Ownership: a row this module creates carries `config.nodeId`. Rows WITHOUT a
 * `nodeId` were created directly against `POST /v1/workflow-triggers` (curl, a
 * script, an integration) and are left strictly alone — reconciling them would
 * delete automation the user set up on purpose.
 */

import { randomBytes } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
  SCHEDULE_TRIGGER_NODE_TYPE,
  WEBHOOK_TRIGGER_NODE_TYPE,
  isCronExpression,
  isValidTimezone,
  legacyScheduleToRules,
  normalizeScheduleRules,
  type ScheduleRule,
} from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { isMissingColumnError } from "./postgrest-errors.js"

export { SCHEDULE_TRIGGER_NODE_TYPE, WEBHOOK_TRIGGER_NODE_TYPE, isCronExpression }

export type SyncedTriggerType = "schedule" | "webhook"

export interface GraphNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}

export interface DesiredTrigger {
  readonly nodeId: string
  readonly type: SyncedTriggerType
  readonly config: Record<string, unknown>
  /**
   * The node is on the graph but cannot run (no usable rule, a timezone the
   * runtime cannot read): keep an EXISTING row — paused, its schedule keys
   * cleared, its `executionCount` and `owner_initiated` intact for the day
   * the node is fixed — and create none. Deleting it instead would restart
   * the run count and lose the owner's vouch when it came back.
   */
  readonly parked?: true
}

export interface ExistingTrigger {
  readonly id: string
  readonly type: string
  readonly config: Record<string, unknown> | null
  readonly is_active: boolean
}

export interface TriggerPlan {
  readonly create: readonly DesiredTrigger[]
  readonly update: ReadonlyArray<{ id: string; config: Record<string, unknown>; isActive: boolean }>
  readonly remove: readonly string[]
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The schedule a `schedule-trigger` node is asking for, as the RULES the cron
 * evaluates (`config.rules` — the model the editor shares, `@nodaro/shared`
 * `schedule-rules`), or null when the node is not configured enough to
 * schedule (a half-filled node must not quietly start running).
 *
 * A node written before the rules model carries `interval` ("5m", or one of
 * the old panel's cron presets — `"0 * * * *"` stored under `interval`) and/or
 * a custom `cron` (`cronExpression` — the name the old panel used). Those
 * convert on the way through, so a row always holds rules and the legacy
 * keys never reach it to shadow them (`scheduleDue` reads `interval` before
 * `cron`, and a cron string under `interval` used to parse as 0 ms — a
 * schedule that never fired and said nothing). Rules present means rules: a
 * stale legacy key beside them is ignored.
 *
 * A timezone the runtime cannot read is a refusal, not a fallback — a
 * schedule that ran at UTC hours its owner never asked for is worse than one
 * that waits to be fixed.
 */
export function normalizeScheduleConfig(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const rules: ScheduleRule[] = Array.isArray(data.rules)
    ? normalizeScheduleRules(data.rules)
    : legacyScheduleToRules(data)
  if (rules.length === 0) return null

  const timezone = trimmed(data.timezone)
  if (timezone && !isValidTimezone(timezone)) return null

  const maxExecutions = data.maxExecutions
  return {
    rules,
    ...(timezone ? { timezone } : {}),
    ...(typeof maxExecutions === "number" && Number.isInteger(maxExecutions) && maxExecutions > 0
      ? { maxExecutions }
      : {}),
  }
}

/** Every trigger the graph asks for, in node order. */
export function desiredTriggersFromGraph(nodes: readonly GraphNode[] | undefined): DesiredTrigger[] {
  const desired: DesiredTrigger[] = []
  const seen = new Set<string>()
  for (const node of nodes ?? []) {
    const nodeId = trimmed(node?.id)
    const nodeType = trimmed(node?.type)
    if (!nodeId || seen.has(nodeId)) continue
    const data = (node?.data && typeof node.data === "object" ? node.data : {}) as Record<string, unknown>

    if (nodeType === SCHEDULE_TRIGGER_NODE_TYPE) {
      seen.add(nodeId)
      const config = normalizeScheduleConfig(data)
      desired.push(config ? { nodeId, type: "schedule", config } : { nodeId, type: "schedule", config: {}, parked: true })
    } else if (nodeType === WEBHOOK_TRIGGER_NODE_TYPE) {
      seen.add(nodeId)
      desired.push({ nodeId, type: "webhook", config: {} })
    }
  }
  return desired
}

/**
 * Every key that describes the schedule. Runtime state the cron writes back
 * onto `config` (`executionCount`) is everything else, and a re-save must not
 * clobber it.
 */
const SCHEDULE_CONFIG_KEYS = ["rules", "cron", "interval", "timezone", "maxExecutions"] as const

/**
 * Desired config merged onto the stored one: runtime state (`executionCount`)
 * survives, and EVERY schedule key is dropped first so a row written before
 * the rules model cannot keep its `interval` / `cron` beside the new rules,
 * and a switch of timezone cannot leave the old one behind.
 */
export function mergeTriggerConfig(
  existing: Record<string, unknown> | null,
  desired: Record<string, unknown>,
  nodeId: string,
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing ?? {})) {
    if ((SCHEDULE_CONFIG_KEYS as readonly string[]).includes(key)) continue
    preserved[key] = value
  }
  return { ...preserved, ...desired, nodeId }
}

/**
 * `PATCH /v1/workflow-triggers/:id` config semantics: the submitted keys land
 * ON TOP of the stored config — a PATCH of the timezone alone keeps the
 * rules — and the row's `nodeId` (its link to the node that manages it) and
 * `executionCount` (the cron's own count) are never the caller's to change.
 * One family of schedule keys at a time: submitting `rules` drops a stored
 * `interval` / `cron`; submitting either of those without rules drops stored
 * `rules` — whichever the caller just said is what runs, never a stale key
 * shadowing it.
 */
export function applyTriggerConfigPatch(
  existing: Record<string, unknown> | null,
  submitted: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existing ?? {}) }
  if (submitted.rules !== undefined) {
    delete base.interval
    delete base.cron
  } else if (submitted.interval !== undefined || submitted.cron !== undefined) {
    delete base.rules
  }
  const merged: Record<string, unknown> = { ...base, ...submitted }
  if (existing && typeof existing.nodeId === "string") merged.nodeId = existing.nodeId
  else delete merged.nodeId
  if (existing && existing.executionCount !== undefined) merged.executionCount = existing.executionCount
  else delete merged.executionCount
  return merged
}

/** Pure diff: what to create, update and delete. Rows without `nodeId` are not ours. */
export function planTriggerSync(
  desired: readonly DesiredTrigger[],
  existing: readonly ExistingTrigger[],
): TriggerPlan {
  const owned = new Map<string, ExistingTrigger>()
  for (const row of existing) {
    const nodeId = trimmed((row.config ?? {}).nodeId)
    if (!nodeId) continue
    // A duplicate key can only come from hand-edited rows; keep the first and
    // let the rest be removed so the graph stays authoritative.
    if (!owned.has(`${row.type}:${nodeId}`)) owned.set(`${row.type}:${nodeId}`, row)
  }

  const create: DesiredTrigger[] = []
  const update: Array<{ id: string; config: Record<string, unknown>; isActive: boolean }> = []
  const matched = new Set<string>()

  for (const want of desired) {
    const key = `${want.type}:${want.nodeId}`
    const row = owned.get(key)
    if (!row) {
      if (!want.parked) create.push(want)
      continue
    }
    matched.add(key)
    const config = mergeTriggerConfig(row.config, want.config, want.nodeId)
    const wantActive = !want.parked
    if (!isDeepStrictEqual(config, row.config) || row.is_active !== wantActive) {
      update.push({ id: row.id, config, isActive: wantActive })
    }
  }

  const remove: string[] = []
  for (const [key, row] of owned) {
    if (!matched.has(key)) remove.push(row.id)
  }
  // A duplicate owned row never entered the map, so sweep it too.
  const keptIds = new Set([...owned.values()].map((r) => r.id))
  for (const row of existing) {
    if (keptIds.has(row.id)) continue
    if (!trimmed((row.config ?? {}).nodeId)) continue
    remove.push(row.id)
  }

  return { create, update, remove }
}

export interface ReconcileResult {
  readonly created: number
  readonly updated: number
  readonly removed: number
  readonly error?: string
}

const EMPTY: ReconcileResult = { created: 0, updated: 0, removed: 0 }

/**
 * Project the graph's trigger nodes onto `workflow_triggers`. Call AFTER the
 * workflow row is written. Never throws: the save has already happened, and a
 * trigger-sync failure must not turn a successful save into a 500.
 */
export async function reconcileWorkflowTriggers(params: {
  readonly workflowId: string
  readonly userId: string
  readonly nodes: readonly GraphNode[] | undefined
  /**
   * Node ids the OWNER, in their own browser session, ADDED in the save this
   * projection follows — the editor's sync after its save names them. A row
   * CREATED for one of them is stamped `owner_initiated` (plan D3, migration
   * 436); every other created row, and every existing row, keeps the default.
   * Narrow on purpose: a node that was already in the stored graph may have
   * been written by an API token or an OAuth app AS the owner, and the
   * owner's next autosave must not launder that into a vouched schedule.
   */
  readonly vouchNodeIds?: ReadonlyArray<string>
}): Promise<ReconcileResult> {
  const { workflowId, userId, nodes } = params
  const vouched = new Set(params.vouchNodeIds ?? [])
  try {
    const desired = desiredTriggersFromGraph(nodes)

    const { data: rows, error: listError } = await supabase
      .from("workflow_triggers")
      .select("id, type, config, is_active")
      .eq("workflow_id", workflowId)
      .eq("user_id", userId)
      .in("type", ["schedule", "webhook"])

    if (listError) return { ...EMPTY, error: listError.message }

    const existing = (rows ?? []) as ExistingTrigger[]
    // Nothing on either side: the overwhelmingly common save. No writes.
    if (desired.length === 0 && existing.length === 0) return EMPTY

    const plan = planTriggerSync(desired, existing)

    if (plan.create.length > 0) {
      const rows = plan.create.map((t) => ({
        workflow_id: workflowId,
        user_id: userId,
        type: t.type,
        config: { ...t.config, nodeId: t.nodeId },
        // The token IS the auth for a webhook, so it is minted once here and
        // then left alone by every later save.
        webhook_token: t.type === "webhook" ? randomBytes(32).toString("hex") : null,
        is_active: true,
      }))
      // `owner_initiated` rides only on the rows the caller vouched for (see
      // the param), and only on the wire when true — the default is already
      // false, so a database that does not have the column yet (migration 436
      // not landed) only ever sees it on a "yes"; that write is retried
      // without it. Two inserts because PostgREST wants one key set per batch.
      const vouchedRows = rows.filter((r) => vouched.has(String(r.config.nodeId)))
      const plainRows = rows.filter((r) => !vouched.has(String(r.config.nodeId)))
      if (plainRows.length > 0) {
        const { error } = await supabase.from("workflow_triggers").insert(plainRows)
        if (error) return { ...EMPTY, error: error.message }
      }
      if (vouchedRows.length > 0) {
        let { error } = await supabase
          .from("workflow_triggers")
          .insert(vouchedRows.map((r) => ({ ...r, owner_initiated: true })))
        if (error && isMissingColumnError(error)) {
          ;({ error } = await supabase.from("workflow_triggers").insert(vouchedRows))
        }
        if (error) return { ...EMPTY, error: error.message }
      }
    }

    for (const row of plan.update) {
      const { error } = await supabase
        .from("workflow_triggers")
        .update({ config: row.config, is_active: row.isActive })
        .eq("id", row.id)
        .eq("user_id", userId)
      if (error) return { ...EMPTY, error: error.message }
    }

    if (plan.remove.length > 0) {
      const { error } = await supabase
        .from("workflow_triggers")
        .delete()
        .in("id", plan.remove)
        .eq("user_id", userId)
      if (error) return { ...EMPTY, error: error.message }
    }

    return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length }
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) }
  }
}
