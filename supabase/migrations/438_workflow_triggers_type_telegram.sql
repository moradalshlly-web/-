-- 438_workflow_triggers_type_telegram.sql
-- `workflow_triggers.type` may be 'telegram'.
--
-- The column was born with an inline CHECK allowing only 'webhook' and
-- 'schedule' (migration 036). Two lanes have written 'telegram' since —
-- `POST /v1/telegram/triggers` (routes/telegram-webhook.ts) and the save-time
-- projection of a Telegram Trigger node (lib/workflow-trigger-sync.ts, #1583)
-- — and no migration ever widened the constraint. On any database built from
-- this directory (CI, a fresh install, production unless it drifted by hand)
-- every one of those INSERTs fails with check_violation (SQLSTATE 23514): the
-- node shows "Active — listening" and nothing is ever registered. Unit tests
-- never saw it because they mock Supabase; the shared project had no telegram
-- row yet, so nobody had hit it.
--
-- Migration 249 widened the SIBLING constraint (`workflow_executions.
-- trigger_type`) for the same feature and left this one alone; the guard test
-- that caught that class of drift (`trigger-type-constraint-sync.test.ts`)
-- reads only the sibling. `workflow-triggers-type-constraint-sync.test.ts`
-- now reads this one, and the behavioral proof
-- `supabase/tests/workflow-triggers-type.behavior.sql` inserts the value.
--
-- Postgres named the inline CHECK `workflow_triggers_type_check` (table_column
-- _check); the DROP is IF EXISTS so a database where it was already removed
-- by hand converges on the same definition.

ALTER TABLE public.workflow_triggers
  DROP CONSTRAINT IF EXISTS workflow_triggers_type_check;

ALTER TABLE public.workflow_triggers
  ADD CONSTRAINT workflow_triggers_type_check
  CHECK (type IN ('webhook', 'schedule', 'telegram'));
