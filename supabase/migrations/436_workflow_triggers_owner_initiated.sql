-- 436_workflow_triggers_owner_initiated.sql
-- "Was this trigger set up by the workflow's owner, in person, from the app?"
--
-- A schedule's runs carry no external input, so a schedule the OWNER created
-- from their own browser session counts as the owner's own run — and a PLAIN
-- stored HTTP credential (migration 435) may travel on it. A personal API
-- token or an OAuth app token runs AS the owner; a schedule either of them
-- creates, or one projected from an API graph write, must NOT count, or a
-- leaked token could mint an unattended run that sends the owner's plain
-- credential wherever `workflows:write` can point a node.
--
-- The flag is decided once, at POST /v1/workflow-triggers
-- (backend/src/routes/webhook-triggers.ts), from the request's auth kind, and
-- read back by the schedule cron (backend/src/lib/schedule-cron.ts). The
-- default is the safe answer, so every pre-existing row and every other
-- writer says "no". The API roles cannot say "yes": the row-owner UPDATE
-- policy on this table (migration 036) would otherwise let a signed-in user
-- flip the flag on a token-created row through PostgREST, so a BEFORE trigger
-- keeps the column service-role-only — an INSERT from `authenticated`/`anon`
-- lands false, an UPDATE keeps whatever the backend wrote.
--
-- Proof: supabase/tests/workflow-triggers-owner-initiated.behavior.sql.

ALTER TABLE public.workflow_triggers
  ADD COLUMN IF NOT EXISTS owner_initiated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workflow_triggers.owner_initiated IS
  'Set up by the workflow owner in person (browser session), so a plain stored HTTP credential may travel on its runs. Written only by the backend (POST /v1/workflow-triggers); the API roles cannot set it.';

CREATE OR REPLACE FUNCTION public.workflow_triggers_guard_owner_initiated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only the backend decides provenance. `current_user` is the role
  -- PostgREST switched to for the request: the backend's service client is
  -- service_role, migrations and proofs run as postgres / supabase_admin.
  -- Every other role — the API roles today, anything added later — is held
  -- to the default, so a new client cannot widen this by existing.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.owner_initiated := false;
    ELSE
      NEW.owner_initiated := OLD.owner_initiated;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_triggers_guard_owner_initiated ON public.workflow_triggers;
CREATE TRIGGER workflow_triggers_guard_owner_initiated
  BEFORE INSERT OR UPDATE ON public.workflow_triggers
  FOR EACH ROW EXECUTE FUNCTION public.workflow_triggers_guard_owner_initiated();
