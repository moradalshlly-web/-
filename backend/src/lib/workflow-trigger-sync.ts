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
import { supabase } from "./supabase.js"

export const SCHEDULE_TRIGGER_NODE_TYPE = "schedule-trigger"
export const WEBHOOK_TRIGGER_NODE_TYPE = "webhook-trigger"

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

/**
 * `shouldTriggerFire` reads `config.interval` FIRST and ignores `config.cron`
 * when it is set, and `parseIntervalToMs` only understands `<n><s|m|h|d>`.
 * The editor panel stores its presets (`"0 * * * *"`, …) under `interval`, so
 * an un-normalised copy of node data would land a cron string in the key that
 * shadows cron and parses to 0 ms — a schedule that never fires and says
 * nothing. Everything below funnels into exactly ONE of `cron` / `interval`.
 */
const INTERVAL_RE = /^\d+[smhd]$/

/** A 5-field cron expression, the only shape `matchesCronMinute` understands. */
export function isCronExpression(value: string): boolean {
  return value.split(/\s+/).filter(Boolean).length === 5
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The schedule a `schedule-trigger` node is asking for, or null when the node
 * is not configured enough to schedule (a half-filled node must not quietly
 * start running). `cronExpression` is read because the editor panel wrote the
 * custom cron under that name while the node type, the node card and this
 * table all use `cron`.
 */
export function normalizeScheduleConfig(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const interval = trimmed(data.interval)
  const explicitCron = trimmed(data.cron) || trimmed(data.cronExpression)

  let schedule: { cron: string } | { interval: string } | null = null
  if (INTERVAL_RE.test(interval)) {
    schedule = { interval }
  } else {
    // "custom" (or nothing) selected -> the typed expression; otherwise the
    // preset itself already IS the cron string.
    const expression = interval === "" || interval === "custom" ? explicitCron : interval
    if (isCronExpression(expression)) schedule = { cron: expression }
  }
  if (!schedule) return null

  const timezone = trimmed(data.timezone)
  const maxExecutions = data.maxExecutions
  return {
    ...schedule,
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
      const config = normalizeScheduleConfig(data)
      if (config) {
        seen.add(nodeId)
        desired.push({ nodeId, type: "schedule", config })
      }
    } else if (nodeType === WEBHOOK_TRIGGER_NODE_TYPE) {
      seen.add(nodeId)
      desired.push({ nodeId, type: "webhook", config: {} })
    }
  }
  return desired
}

/**
 * Runtime state the cron writes back onto `config` and a re-save must not
 * clobber — `schedule-cron.ts` increments `executionCount` there.
 */
const SCHEDULE_CONFIG_KEYS = ["cron", "interval", "timezone", "maxExecutions"] as const

/**
 * Desired config merged onto the stored one: runtime state (`executionCount`)
 * survives, and EVERY schedule key is dropped first so a switch from interval
 * to cron cannot leave the old key behind to shadow the new one.
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
      create.push(want)
      continue
    }
    matched.add(key)
    const config = mergeTriggerConfig(row.config, want.config, want.nodeId)
    if (!isDeepStrictEqual(config, row.config) || !row.is_active) {
      update.push({ id: row.id, config, isActive: true })
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
}): Promise<ReconcileResult> {
  const { workflowId, userId, nodes } = params
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
      // Never `owner_initiated`: the caller's request is not proof the OWNER
      // placed the node — an API token's or an OAuth app's graph write arrives
      // here as the owner — so the column keeps its default and a plain stored
      // credential will not travel on a schedule projected from a graph. Only
      // POST /v1/workflow-triggers, from a browser session, decides it.
      const { error } = await supabase.from("workflow_triggers").insert(
        plan.create.map((t) => ({
          workflow_id: workflowId,
          user_id: userId,
          type: t.type,
          config: { ...t.config, nodeId: t.nodeId },
          // The token IS the auth for a webhook, so it is minted once here and
          // then left alone by every later save.
          webhook_token: t.type === "webhook" ? randomBytes(32).toString("hex") : null,
          is_active: true,
        })),
      )
      if (error) return { ...EMPTY, error: error.message }
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
