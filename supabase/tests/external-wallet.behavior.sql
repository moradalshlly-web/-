-- Full migration-chain behavioral test; all account data rolls back.
BEGIN;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('00000000-0000-4000-8000-00000000e001','wallet-payer@example.test','{"sso":"sai","sso_subject":"payer"}'),
 ('00000000-0000-4000-8000-00000000e002','wallet-user@example.test','{"sso":"sai","sso_subject":"trusted-subject"}');
UPDATE public.profiles SET tier='business',subscription_tier='business',subscription_credits=1000,topup_credits=0
 WHERE id='00000000-0000-4000-8000-00000000e001';
CREATE FUNCTION pg_temp.wallet_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.wallet_refused(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE 'EXTERNAL_WALLET_%' THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'ASSERT FAIL: expected wallet refusal';
END $$;
SELECT pg_temp.wallet_assert(NOT has_table_privilege('authenticated','public.external_wallet_operations','SELECT'),'journal hidden');
SELECT pg_temp.wallet_assert(NOT has_function_privilege('authenticated','public.prepare_external_wallet(uuid,uuid,uuid,text)','EXECUTE'),'prepare private');
SELECT pg_temp.wallet_assert(NOT has_function_privilege('anon','public.authorize_external_wallet(uuid)','EXECUTE'),'authorize private');
SELECT pg_temp.wallet_assert(NOT has_function_privilege('authenticated','public.abort_external_wallet(uuid)','EXECUTE'),'abort private');
SET LOCAL ROLE service_role;
DO $$ DECLARE v_id uuid; w jsonb; again jsonb; BEGIN
 v_id:=public.reserve_credits('00000000-0000-4000-8000-00000000e001',100,NULL,'test-wallet',p_on_behalf_of=>'00000000-0000-4000-8000-00000000e002');
 w:=public.prepare_external_wallet(v_id,'00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-00000000e001','sai');
 again:=public.prepare_external_wallet(v_id,'00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-00000000e001','sai');
 PERFORM pg_temp.wallet_assert(w=again,'prepare replay is immutable');
 PERFORM pg_temp.wallet_assert(w->>'sso_subject'='trusted-subject','trusted subject snapshot');
 PERFORM pg_temp.wallet_refused(format('SELECT public.commit_credits(%L,40)',v_id));
 PERFORM pg_temp.wallet_refused(format('DELETE FROM public.usage_logs WHERE id=%L',v_id));
 PERFORM pg_temp.wallet_refused(format('SELECT public.prepare_external_wallet(%L,%L,%L,%L)',v_id,'00000000-0000-4000-8000-00000000e001','00000000-0000-4000-8000-00000000e001','sai'));
 PERFORM pg_temp.wallet_assert(public.authorize_external_wallet(v_id),'authorization persisted');
 PERFORM pg_temp.wallet_assert(public.abort_external_wallet(v_id),'late abort cannot cancel authorized work');
 PERFORM public.commit_credits(v_id,40);
 PERFORM pg_temp.wallet_assert((SELECT actual_credits=40 AND delivered_at IS NULL FROM public.external_wallet_operations WHERE usage_log_id=v_id),'partial charge queued atomically');
 PERFORM pg_temp.wallet_assert((SELECT subscription_credits=960 FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000e001'),'unused local credits restored');
 PERFORM public.commit_credits(v_id,40);
 PERFORM pg_temp.wallet_assert((SELECT count(*)=1 FROM public.external_wallet_operations WHERE usage_log_id=v_id),'settlement replay creates no duplicate');
 PERFORM pg_temp.wallet_refused(format('UPDATE public.usage_logs SET credits_charged=41 WHERE id=%L',v_id));
 PERFORM pg_temp.wallet_refused(format('UPDATE public.usage_logs SET status=%L WHERE id=%L','reserved',v_id));
 DELETE FROM public.usage_logs WHERE public.usage_logs.id=(w->>'usage_log_id')::uuid;
 PERFORM pg_temp.wallet_assert((SELECT actual_credits=40 AND delivered_at IS NULL FROM public.external_wallet_operations WHERE usage_log_id=v_id),'outbox survives settled usage deletion');
 RAISE NOTICE 'ok authorization, immutable identity, partial settlement and replay';
END $$;
DO $$ DECLARE v_id uuid; BEGIN
 v_id:=public.reserve_credits('00000000-0000-4000-8000-00000000e001',100,NULL,'test-wallet',p_on_behalf_of=>'00000000-0000-4000-8000-00000000e002');
 PERFORM public.prepare_external_wallet(v_id,'00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-00000000e001','sai');
 PERFORM pg_temp.wallet_assert(NOT public.abort_external_wallet(v_id),'unknown reserve is cancelled');
 PERFORM pg_temp.wallet_assert(NOT public.authorize_external_wallet(v_id),'late approval cannot dispatch');
 PERFORM pg_temp.wallet_assert((SELECT actual_credits=0 AND delivered_at IS NULL FROM public.external_wallet_operations WHERE usage_log_id=v_id),'terminal tombstone queued');
 PERFORM pg_temp.wallet_assert((SELECT subscription_credits=960 FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000e001'),'local hold restored exactly once');
 PERFORM public.abort_external_wallet(v_id);
 PERFORM pg_temp.wallet_assert((SELECT subscription_credits=960 FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000e001'),'abort replay no double refund');
 RAISE NOTICE 'ok cancellation before late authorization and exactly once local refund';
END $$;
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{}',raw_user_meta_data='{"sso":"sai","sso_subject":"forged"}'
 WHERE id='00000000-0000-4000-8000-00000000e002';
SET LOCAL ROLE service_role;
DO $$ DECLARE v_id uuid; BEGIN
 v_id:=public.reserve_credits('00000000-0000-4000-8000-00000000e001',10,NULL,'test-wallet',p_on_behalf_of=>'00000000-0000-4000-8000-00000000e002');
 PERFORM pg_temp.wallet_refused(format('SELECT public.prepare_external_wallet(%L,%L,%L,%L)',v_id,'00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-00000000e001','sai'));
 PERFORM public.abort_external_wallet(v_id);
 PERFORM pg_temp.wallet_assert((SELECT subscription_credits=960 FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000e001'),'missing identity refunded without external call');
END $$;
RESET ROLE;
ROLLBACK;
