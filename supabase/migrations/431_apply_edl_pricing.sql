-- apply-edl node: render an edit decision list (EDL) into ONE media file
-- (video OR audio) with a local ffmpeg pass — no provider cost. Core, keyless.
--
-- Pricing: PER MINUTE of RENDERED output. The route's creditGuard.computeCredits
-- and the DAG's applyEdlCreditOverride both reserve
--   this_per_minute_base × ceil(edlDurationMs / 60000)   (minimum 1 minute)
-- on the D17 overlap-compressed rendered duration. The bare identifier is the
-- estimator fallback (1-minute floor). Mirrors STATIC_CREDIT_COSTS['apply-edl']
-- in backend/src/ee/billing/credits.ts, whose value is the single source of
-- truth APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE in backend/src/lib/apply-edl-plan.ts.
--
-- PROVISIONAL — the 3-hour staging probe sets the final per-minute number by
-- re-derivation (never scaling). An admin retune survives re-application via
-- ON CONFLICT DO NOTHING.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('apply-edl', 10)
ON CONFLICT (model_identifier) DO NOTHING;
