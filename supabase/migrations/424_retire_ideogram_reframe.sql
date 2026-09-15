-- 424: retire `ideogram-reframe` (KIE `ideogram/v3-reframe`).
--
-- KIE no longer documents the model and every task fails upstream with
-- "[500] internal error" — verified 2026-09-15 with the minimal documented
-- payload (image_url + image_size), so the failure is the model, not our
-- request (#1331). The platform kept selling it: selectable in the picker,
-- advertised through MCP, 18 credits reserved, always refunded ~30s later.
--
-- The code drops the model from every surface in the same PR (catalog,
-- constants, KIE config, STATIC_CREDIT_COSTS, picker, prompt-wizard, docs);
-- this removes its price rows so /admin/models stops listing a model nothing
-- can run. Idempotent. Re-seed with an INSERT ... ON CONFLICT DO NOTHING if
-- KIE brings the model back.
DELETE FROM public.model_pricing
WHERE model_identifier IN ('ideogram-reframe', 'ideogram-reframe:TURBO', 'ideogram-reframe:QUALITY');
