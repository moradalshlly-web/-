-- ============================================================================
-- Behavioral proof: http_credentials is service-role only (migration 435).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000951 upward).
--
-- The assertions that matter are #2 and #3: the API roles cannot read the
-- table at all — a signed-in user (even the row's OWNER) and an anonymous
-- caller are refused by privilege, before RLS is even consulted. A policy text
-- review cannot prove that; only executing as the role can. It also fails if
-- a future migration GRANTs the table back or adds a permissive policy, which
-- is the way this leak would come back.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/http-credentials-privacy.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000951', 'hc-owner@hc.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000952', 'hc-stranger@hc.test', '{}', 'authenticated', 'authenticated');

-- 0. The proof is not vacuous: a row exists to be denied (written as the
--    service role would write it — as postgres here).
INSERT INTO http_credentials (id, user_id, name, auth_kind, config, ciphertext, bound_url, bound_match)
VALUES ('00000000-0000-4000-8000-000000000953', '00000000-0000-4000-8000-000000000951',
        'Grok bot', 'header', '{"headerName":"Authorization"}', 'ZW52ZWxvcGU=',
        'https://hooks.example.com/in/abc', 'exact');
SELECT pg_temp.assert_eq('http_credentials has a row (as postgres)',
  (SELECT count(*)::text FROM http_credentials), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on http_credentials',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'http_credentials'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on http_credentials',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='http_credentials'), '0');
SELECT pg_temp.assert_eq('authenticated holds no SELECT privilege on http_credentials',
  has_table_privilege('authenticated', 'public.http_credentials', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no INSERT/UPDATE/DELETE privilege on http_credentials',
  (has_table_privilege('authenticated', 'public.http_credentials', 'INSERT')
   OR has_table_privilege('authenticated', 'public.http_credentials', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.http_credentials', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT privilege on http_credentials',
  has_table_privilege('anon', 'public.http_credentials', 'SELECT')::text, 'false');

-- 2. THE LEAK: the row's OWNER, signed in, cannot read it through the API
--    role — refused by privilege (the envelope never reaches a browser).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000951","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000951';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM http_credentials;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT http_credentials as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT http_credentials as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO http_credentials (user_id, name, auth_kind, config, ciphertext)
    VALUES ('00000000-0000-4000-8000-000000000951', 'forged', 'header', '{}', 'eA==');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT http_credentials]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT http_credentials (privilege denied)';
END $$;
RESET ROLE;

-- 3. Anonymous is refused the same way. Clear the JWT so this is a true anon
--    read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM http_credentials;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT http_credentials]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT http_credentials (privilege denied)';
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on: one name per user, cascade on user delete.
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO http_credentials (user_id, name, auth_kind, config, ciphertext)
    VALUES ('00000000-0000-4000-8000-000000000951', 'Grok bot', 'header', '{}', 'eA==');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [duplicate name per user is refused]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  duplicate name per user is refused (unique_violation)';
END $$;
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000951';
SELECT pg_temp.assert_eq('deleting the user cascades to their credentials',
  (SELECT count(*)::text FROM http_credentials WHERE user_id = '00000000-0000-4000-8000-000000000951'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
