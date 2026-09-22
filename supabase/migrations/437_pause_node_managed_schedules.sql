-- 437_pause_node_managed_schedules.sql
-- A Schedule Trigger node now carries a switch (`data.active`): a schedule
-- fires only while its node says so, a NEW schedule starts paused, and the
-- graph projection (backend/src/lib/workflow-trigger-sync.ts) writes the
-- switch onto `workflow_triggers.is_active` on every save.
--
-- Rows the projection created BEFORE the switch existed were armed on save.
-- Their nodes carry no `active` yet, so the next save will pause them anyway;
-- a row whose workflow is never saved again would keep firing on the old
-- rule alone. Pause every node-managed schedule row once, here, so the
-- installed base matches the new rule ("existing schedules start paused too").
--
-- Node-managed rows are the ones carrying `config.nodeId` — rows created by
-- hand through POST /v1/workflow-triggers carry none and are left alone.
-- Data only; no schema change.

UPDATE public.workflow_triggers
SET is_active = false
WHERE type = 'schedule'
  AND is_active = true
  AND config ? 'nodeId';
