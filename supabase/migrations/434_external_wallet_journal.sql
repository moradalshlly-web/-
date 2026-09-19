-- A journal/outbox bridges local reservations to a deployment's external wallet.
-- No network calls or configuration credentials live in the database.
CREATE TABLE IF NOT EXISTS public.external_wallet_operations (
  usage_log_id uuid PRIMARY KEY REFERENCES public.usage_logs(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL,
  job_id uuid,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 128),
  sso_subject text NOT NULL CHECK (length(sso_subject) BETWEEN 1 AND 512),
  model_identifier text NOT NULL,
  reserved_credits integer NOT NULL CHECK (reserved_credits > 0),
  authorized_at timestamptz,
  actual_credits integer CHECK (actual_credits >= 0 AND actual_credits <= reserved_credits),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.external_wallet_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_wallet_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.external_wallet_operations TO service_role;
CREATE INDEX IF NOT EXISTS external_wallet_pending ON public.external_wallet_operations(next_attempt_at)
  WHERE actual_credits IS NOT NULL AND delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS external_wallet_unauthorized ON public.external_wallet_operations(created_at)
  WHERE authorized_at IS NULL AND actual_credits IS NULL;

CREATE OR REPLACE FUNCTION public.prepare_external_wallet(p_usage_log_id uuid, p_user_id uuid, p_payer_id uuid, p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.usage_logs%ROWTYPE; w public.external_wallet_operations%ROWTYPE; a jsonb;
BEGIN
  SELECT * INTO u FROM public.usage_logs WHERE id=p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR u.user_id IS DISTINCT FROM p_payer_id OR coalesce(u.on_behalf_of,u.user_id) IS DISTINCT FROM p_user_id
    OR u.workspace_id IS NOT NULL OR u.status IS DISTINCT FROM 'reserved' OR u.credits_used<=0 THEN
    RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: active owned reservation required';
  END IF;
  SELECT * INTO w FROM public.external_wallet_operations WHERE usage_log_id=p_usage_log_id;
  IF FOUND THEN
    IF w.requester_id IS DISTINCT FROM p_user_id OR w.provider IS DISTINCT FROM p_provider
      OR w.reserved_credits IS DISTINCT FROM u.credits_used OR w.actual_credits IS NOT NULL THEN
      RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: reservation changed';
    END IF;
    RETURN to_jsonb(w);
  END IF;
  SELECT raw_app_meta_data INTO a FROM auth.users WHERE id=p_user_id;
  IF a->>'sso' IS DISTINCT FROM p_provider OR coalesce(a->>'sso_subject','')='' THEN
    RAISE EXCEPTION 'EXTERNAL_WALLET_IDENTITY: trusted SSO identity required';
  END IF;
  INSERT INTO public.external_wallet_operations(usage_log_id,requester_id,job_id,provider,sso_subject,model_identifier,reserved_credits)
    VALUES(p_usage_log_id,p_user_id,u.job_id,p_provider,a->>'sso_subject',u.action,u.credits_used) RETURNING * INTO w;
  UPDATE public.usage_logs SET metadata=coalesce(metadata,'{}'::jsonb)||'{"external_wallet":true}'::jsonb WHERE id=p_usage_log_id;
  RETURN to_jsonb(w);
END $$;

CREATE OR REPLACE FUNCTION public.authorize_external_wallet(p_usage_log_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE u public.usage_logs%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.usage_logs WHERE id=p_usage_log_id FOR UPDATE;
  IF NOT FOUND OR u.status IS DISTINCT FROM 'reserved' THEN RETURN false; END IF;
  UPDATE public.external_wallet_operations SET authorized_at=coalesce(authorized_at,now())
    WHERE usage_log_id=p_usage_log_id AND actual_credits IS NULL;
  RETURN FOUND;
END $$;

-- Return true if a concurrent caller already obtained authorization. Otherwise
-- cancel the local hold; the trigger below persists terminal zero settlement.
CREATE OR REPLACE FUNCTION public.abort_external_wallet(p_usage_log_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE u public.usage_logs%ROWTYPE; w public.external_wallet_operations%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.usage_logs WHERE id=p_usage_log_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO w FROM public.external_wallet_operations WHERE usage_log_id=p_usage_log_id;
  IF w.authorized_at IS NOT NULL AND u.status='reserved' THEN RETURN true; END IF;
  IF u.status='reserved' THEN PERFORM public.refund_credits(p_usage_log_id); END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.capture_external_wallet_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE w public.external_wallet_operations%ROWTYPE; amount integer;
BEGIN
  SELECT * INTO w FROM public.external_wallet_operations WHERE usage_log_id=NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.credits_used IS DISTINCT FROM w.reserved_credits
    OR coalesce(NEW.on_behalf_of,NEW.user_id) IS DISTINCT FROM w.requester_id THEN
    RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: immutable reservation changed';
  END IF;
  IF NEW.status NOT IN ('committed','refunded') THEN
    IF w.actual_credits IS NOT NULL THEN RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: cannot reopen settlement'; END IF;
    RETURN NEW;
  END IF;
  amount := CASE WHEN NEW.status='refunded' THEN 0 ELSE NEW.credits_charged END;
  IF amount IS NULL OR amount<0 OR amount>w.reserved_credits
    OR (NEW.status='committed' AND w.authorized_at IS NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: authorized charge within reservation required';
  END IF;
  IF w.actual_credits IS NOT NULL AND w.actual_credits IS DISTINCT FROM amount THEN
    RAISE EXCEPTION 'EXTERNAL_WALLET_CONFLICT: settlement already decided';
  END IF;
  UPDATE public.external_wallet_operations SET actual_credits=amount
    WHERE usage_log_id=NEW.id AND actual_credits IS NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS external_wallet_settlement ON public.usage_logs;
CREATE TRIGGER external_wallet_settlement AFTER UPDATE ON public.usage_logs
  FOR EACH ROW EXECUTE FUNCTION public.capture_external_wallet_settlement();

REVOKE ALL ON FUNCTION public.prepare_external_wallet(uuid,uuid,uuid,text), public.authorize_external_wallet(uuid),
  public.abort_external_wallet(uuid), public.capture_external_wallet_settlement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_external_wallet(uuid,uuid,uuid,text), public.authorize_external_wallet(uuid),
  public.abort_external_wallet(uuid), public.capture_external_wallet_settlement() TO service_role;
