-- silence-detect was seeded at 1 credit (migration 430): a slip against the
-- ×10 credit re-denomination (2026-07-30) — its local-ffmpeg siblings
-- trim-audio / extract-audio / combine-audio / adjust-volume are 10. Tal
-- confirmed the correction on 2026-09-23 → 10.
--
-- Conditional UPDATE: only a row still at the wrongly seeded value moves, so a
-- genuine administrator override is preserved. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'silence-detect' AND credit_cost = 1;
