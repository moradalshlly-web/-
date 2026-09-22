/**
 * The node types the server projects onto `workflow_triggers` rows when a
 * workflow is saved (backend `lib/workflow-trigger-sync.ts`), and that the
 * editor therefore asks the server to re-project after its own saves. One
 * vocabulary for both sides: a third projected type added here reaches the
 * editor's "does this save need a sync?" question by construction.
 * (`telegram-trigger` registers its own row through the Telegram webhook.)
 */
export const SCHEDULE_TRIGGER_NODE_TYPE = "schedule-trigger"
export const WEBHOOK_TRIGGER_NODE_TYPE = "webhook-trigger"

export const PROJECTED_TRIGGER_NODE_TYPES: ReadonlySet<string> = new Set([
  SCHEDULE_TRIGGER_NODE_TYPE,
  WEBHOOK_TRIGGER_NODE_TYPE,
])

export function isProjectedTriggerNodeType(type: unknown): type is string {
  return typeof type === "string" && PROJECTED_TRIGGER_NODE_TYPES.has(type)
}
