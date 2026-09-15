-- ---------------------------------------------------------------------------
-- 426. Welcome credits opt-in.
--
-- The 1,500-credit signup grant becomes CONSENT-GATED: an account is granted
-- only once its marketing-email consent (`user_consents`, kind
-- 'marketing_email') is 'granted'. The abuse gate (365/366) still decides
-- granted vs withheld AFTER consent — consent is necessary, not sufficient.
--
-- One exception, decided by the caller: the Chrome extension has no consent
-- UI, so an extension-origin claim is granted WITHOUT consent and the profile
-- is marked `welcome_consent_pending`. While that mark is set, every web app
-- blocks creation (the credit guard answers 403 consent_required) until the
-- user says yes anywhere; the consent-grant helper clears the mark.
--
-- Two profile columns:
--   welcome_offer_seen_at    — the welcome popup was shown once (never again)
--   welcome_consent_pending  — granted via the extension, consent still owed
--
-- Behaviour is OFF until an admin sets app_settings.welcome_offer_enabled =
-- true (the code passes the new RPC arguments only when the flag is on, so a
-- dev deploy running ahead of this migration keeps today's byte-identical
-- claim call).
-- ---------------------------------------------------------------------------

-- 1. Columns.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_offer_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_consent_pending boolean NOT NULL DEFAULT false;

-- 2. claim_signup_grant — consent gate + extension mark.
--
-- The 3-argument overload must go: PostgREST resolves an RPC by the NAMED
-- arguments it receives, and with defaults on the new parameters a 3-key call
-- would match both overloads (HTTP 300 "could not choose the best candidate").
DROP FUNCTION IF EXISTS public.claim_signup_grant(uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.claim_signup_grant(
  p_user_id uuid,
  p_grant_amount integer,
  p_withhold boolean DEFAULT false,
  p_require_consent boolean DEFAULT false,
  p_mark_consent_pending boolean DEFAULT false
)
RETURNS TABLE (did_claim boolean, old_credits integer, new_credits integer, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The gate lives here, not only in the TypeScript caller: a future caller
  -- that forgets the check still cannot move an account without consent.
  IF p_require_consent AND NOT EXISTS (
       SELECT 1 FROM public.user_consents c
        WHERE c.user_id = p_user_id
          AND c.kind = 'marketing_email'
          AND c.status = 'granted'
     ) THEN
    SELECT false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state
      FROM public.profiles AS p
     WHERE p.id = p_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_withhold THEN
    UPDATE public.profiles AS p
       SET free_grant_state = 'withheld',
           welcome_consent_pending = (p.welcome_consent_pending OR p_mark_consent_pending)
     WHERE p.id = p_user_id
       AND p.free_grant_state = 'unclaimed'
    RETURNING false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state;
  ELSE
    UPDATE public.profiles AS p
       SET free_grant_state = 'granted',
           subscription_credits = GREATEST(p.subscription_credits, p_grant_amount),
           welcome_consent_pending = (p.welcome_consent_pending OR p_mark_consent_pending)
      FROM public.profiles AS prior
     WHERE p.id = p_user_id
       AND prior.id = p.id
       AND p.free_grant_state = 'unclaimed'
    RETURNING true, prior.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state;
  END IF;

  IF NOT FOUND THEN
    SELECT false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state
      FROM public.profiles AS p
     WHERE p.id = p_user_id;
  END IF;

  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean, boolean, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean, boolean, boolean) FROM authenticated;

-- The function's signature changed: PostgREST caches the schema, and a stale
-- cache answers "function not found" for every claim until it reloads (the
-- lesson recorded in 366). Same line, same reason.
NOTIFY pgrst, 'reload schema';

-- Coverage: the TypeScript half of the gate is unit-tested; this SQL half
-- (p_require_consent, p_mark_consent_pending, and the denylisted column) is
-- proven against a real Postgres by supabase/tests/free-grant.behavior.sql
-- and profiles-email-not-user-writable.behavior.sql (CI "Migration Behavior").

-- 3. welcome_consent_pending joins the profiles UPDATE denylist.
--
-- A user must not be able to clear their own creation block through RLS.
-- (welcome_offer_seen_at is deliberately NOT denylisted: hiding one's own
-- popup is harmless.) Same shape as 365/385: drop the old signature, recreate
-- with the extra parameter, recreate the policy that passes it.
DROP POLICY IF EXISTS "Users can update own safe columns" ON public.profiles;
DROP FUNCTION IF EXISTS check_profiles_update_allowed(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION check_profiles_update_allowed(
  p_user_id UUID,
  p_role TEXT,
  p_tier TEXT,
  p_subscription_tier TEXT,
  p_subscription_credits INTEGER,
  p_topup_credits INTEGER,
  p_daily_spent_credits INTEGER,
  p_credits_balance INTEGER,
  p_storage_limit_bytes BIGINT,
  p_lifetime_topup_credits INTEGER,
  p_last_topup_at TIMESTAMPTZ,
  p_auto_recharge_enabled BOOLEAN,
  p_auto_recharge_threshold_credits INTEGER,
  p_auto_recharge_amount_usd INTEGER,
  p_auto_recharge_failure_count INTEGER,
  p_auto_recharge_last_attempt_at TIMESTAMPTZ,
  p_auto_recharge_daily_count INTEGER,
  p_auto_recharge_daily_date DATE,
  p_free_grant_state TEXT,
  p_email TEXT,
  p_welcome_consent_pending BOOLEAN
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT role, tier, subscription_tier, subscription_credits, topup_credits,
         daily_spent_credits, credits_balance, storage_limit_bytes,
         lifetime_topup_credits, last_topup_at,
         auto_recharge_enabled, auto_recharge_threshold_credits,
         auto_recharge_amount_usd, auto_recharge_failure_count,
         auto_recharge_last_attempt_at, auto_recharge_daily_count,
         auto_recharge_daily_date, free_grant_state, email,
         welcome_consent_pending
  INTO v FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  RETURN (p_role IS NOT DISTINCT FROM v.role)
    AND (p_tier IS NOT DISTINCT FROM v.tier)
    AND (p_subscription_tier IS NOT DISTINCT FROM v.subscription_tier)
    AND (p_subscription_credits IS NOT DISTINCT FROM v.subscription_credits)
    AND (p_topup_credits IS NOT DISTINCT FROM v.topup_credits)
    AND (p_daily_spent_credits IS NOT DISTINCT FROM v.daily_spent_credits)
    AND (p_credits_balance IS NOT DISTINCT FROM v.credits_balance)
    AND (p_storage_limit_bytes IS NOT DISTINCT FROM v.storage_limit_bytes)
    AND (p_lifetime_topup_credits IS NOT DISTINCT FROM v.lifetime_topup_credits)
    AND (p_last_topup_at IS NOT DISTINCT FROM v.last_topup_at)
    AND (p_auto_recharge_enabled IS NOT DISTINCT FROM v.auto_recharge_enabled)
    AND (p_auto_recharge_threshold_credits IS NOT DISTINCT FROM v.auto_recharge_threshold_credits)
    AND (p_auto_recharge_amount_usd IS NOT DISTINCT FROM v.auto_recharge_amount_usd)
    AND (p_auto_recharge_failure_count IS NOT DISTINCT FROM v.auto_recharge_failure_count)
    AND (p_auto_recharge_last_attempt_at IS NOT DISTINCT FROM v.auto_recharge_last_attempt_at)
    AND (p_auto_recharge_daily_count IS NOT DISTINCT FROM v.auto_recharge_daily_count)
    AND (p_auto_recharge_daily_date IS NOT DISTINCT FROM v.auto_recharge_daily_date)
    AND (p_free_grant_state IS NOT DISTINCT FROM v.free_grant_state)
    AND (p_email IS NOT DISTINCT FROM v.email)
    AND (p_welcome_consent_pending IS NOT DISTINCT FROM v.welcome_consent_pending);
END;
$$;

CREATE POLICY "Users can update own safe columns" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND check_profiles_update_allowed(
      id, role, tier, subscription_tier,
      subscription_credits, topup_credits, daily_spent_credits,
      credits_balance, storage_limit_bytes,
      lifetime_topup_credits, last_topup_at,
      auto_recharge_enabled, auto_recharge_threshold_credits,
      auto_recharge_amount_usd, auto_recharge_failure_count,
      auto_recharge_last_attempt_at, auto_recharge_daily_count,
      auto_recharge_daily_date, free_grant_state, email,
      welcome_consent_pending
    )
  );
