-- ============================================================================
-- Behavioral proof: workflow_triggers.owner_initiated is backend-only
-- (migration 436).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000961 upward).
--
-- The claim the schedule cron relies on: a row says owner_initiated = true
-- ONLY because the backend (service role) wrote it there after checking that
-- the creator was the workflow's owner in a browser session. The table's
-- row-owner policies let a signed-in user INSERT and UPDATE their own trigger
-- rows through PostgREST, so without the guard a user could flip the flag on
-- a token-created schedule. Only executing as the API role proves the guard.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker exec -i mig-test psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/workflow-triggers-owner-initiated.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000961', 'oi-owner@oi.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'oi project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000961', 'c0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'oi wf');

-- 0. Shape: the column exists, NOT NULL, default false.
SELECT pg_temp.assert_eq('owner_initiated is NOT NULL with default false',
  (SELECT is_nullable || '/' || column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workflow_triggers' AND column_name = 'owner_initiated'),
  'NO/false');

-- 1. The backend (service role; `postgres` here) decides — both answers stick.
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config, owner_initiated) VALUES
  ('e0000000-0000-4000-8000-000000000961', 'd0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'schedule', '{"interval":"1h"}', true),
  ('e0000000-0000-4000-8000-000000000962', 'd0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'schedule', '{"interval":"1h"}', false);
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config) VALUES
  ('e0000000-0000-4000-8000-000000000963', 'd0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'schedule', '{"interval":"1h"}');
SELECT pg_temp.assert_eq('the backend can write true',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000961'), 'true');
SELECT pg_temp.assert_eq('the backend can write false',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000962'), 'false');
SELECT pg_temp.assert_eq('a row written without the column is not owner-initiated',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000963'), 'false');

-- 1b. The role the backend really runs as (PostgREST switches to it for the
--     service key) can write true — a typo in the guard's allow-list would
--     otherwise turn every schedule into "not owner-initiated" with nothing red.
SET LOCAL ROLE service_role;
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config, owner_initiated) VALUES
  ('e0000000-0000-4000-8000-000000000965', 'd0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'schedule', '{"interval":"1h"}', true);
SELECT pg_temp.assert_eq('service_role — the backend — can write true',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000965'), 'true');
RESET ROLE;

-- 2. THE GUARD: the row's OWNER, signed in through the API role, cannot say
--    "yes" — not on insert, not on update — while their ordinary writes work.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000961","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000961';

INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config, owner_initiated) VALUES
  ('e0000000-0000-4000-8000-000000000964', 'd0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961', 'schedule', '{"interval":"1h"}', true);
SELECT pg_temp.assert_eq('a signed-in INSERT asking for true lands false',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000964'), 'false');

UPDATE workflow_triggers SET owner_initiated = true WHERE id = 'e0000000-0000-4000-8000-000000000962';
SELECT pg_temp.assert_eq('a signed-in UPDATE cannot flip false to true',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000962'), 'false');

UPDATE workflow_triggers SET is_active = false WHERE id = 'e0000000-0000-4000-8000-000000000961';
SELECT pg_temp.assert_eq('a signed-in UPDATE of another column keeps a backend-written true',
  (SELECT owner_initiated::text || '/' || is_active::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000961'), 'true/false');

UPDATE workflow_triggers SET owner_initiated = false WHERE id = 'e0000000-0000-4000-8000-000000000961';
SELECT pg_temp.assert_eq('the column is simply not the API role''s to write, in either direction',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000961'), 'true');
RESET ROLE;

-- 3. The backend can still move it after the fact (a future writer with a real reason).
UPDATE workflow_triggers SET owner_initiated = false WHERE id = 'e0000000-0000-4000-8000-000000000961';
SELECT pg_temp.assert_eq('the backend can clear it',
  (SELECT owner_initiated::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000961'), 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
