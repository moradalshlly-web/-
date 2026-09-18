-- edit-plan node (podcast editing): a transcript-driven cut / clip / chapter
-- planner. Cloud-EXCLUSIVE + relayed — billing happens on the connected cloud
-- account; these rows are the DB-of-record for the reserve (a seeded row wins
-- over STATIC_CREDIT_COSTS at runtime).
--
-- Pricing: PER SOURCE-MINUTE × tier, plus a flat component on `clips` only.
-- Composite id: `edit-plan:<mode>:<tier>:<bucket>m` (bucket in MINUTES). The
-- reserve rounds the SERVER-KNOWN master-source duration UP to the smallest
-- covering bucket. 3 modes × 3 tiers × 6 buckets (15/30/60/90/120/180) = 54
-- composites + the bare `edit-plan` (= the MAX of the whole table = 1480, the
-- unknown-mode-AND-unknown-duration pre-run balance-gate fallback).
--
-- These MUST match backend/src/ee/billing/credits.ts (EDIT_PLAN_STATIC) and the
-- plugin's editPlanStaticCreditCosts() — formula:
--   perMinute(tier) × bucketMinutes + (mode==="clips" ? clipsFlat(tier) : 0)
--   perMinute:  economy 2, standard 4, premium 8   (credits per source-minute)
--   clipsFlat:  economy 10, standard 20, premium 40 (clips-only, once)
--
-- PROVISIONAL — ALL numbers are PLACEHOLDERS, finalized by the 3-hour staging
-- probe (measure LLM tokens/source-minute per tier, RE-DERIVED not scaled). An
-- admin retune via /admin/models survives re-application via ON CONFLICT DO NOTHING.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('edit-plan',                       1480, true, 'other'),  -- bare = MAX of the table (unknown-mode/unknown-duration ceiling)
  -- ── tighten (no flat) ──
  ('edit-plan:tighten:economy:15m',     30, true, 'other'),
  ('edit-plan:tighten:economy:30m',     60, true, 'other'),
  ('edit-plan:tighten:economy:60m',    120, true, 'other'),
  ('edit-plan:tighten:economy:90m',    180, true, 'other'),
  ('edit-plan:tighten:economy:120m',   240, true, 'other'),
  ('edit-plan:tighten:economy:180m',   360, true, 'other'),
  ('edit-plan:tighten:standard:15m',    60, true, 'other'),
  ('edit-plan:tighten:standard:30m',   120, true, 'other'),
  ('edit-plan:tighten:standard:60m',   240, true, 'other'),
  ('edit-plan:tighten:standard:90m',   360, true, 'other'),
  ('edit-plan:tighten:standard:120m',  480, true, 'other'),
  ('edit-plan:tighten:standard:180m',  720, true, 'other'),
  ('edit-plan:tighten:premium:15m',    120, true, 'other'),
  ('edit-plan:tighten:premium:30m',    240, true, 'other'),
  ('edit-plan:tighten:premium:60m',    480, true, 'other'),
  ('edit-plan:tighten:premium:90m',    720, true, 'other'),
  ('edit-plan:tighten:premium:120m',   960, true, 'other'),
  ('edit-plan:tighten:premium:180m',  1440, true, 'other'),
  -- ── clips (+ flat: economy 10 / standard 20 / premium 40) ──
  ('edit-plan:clips:economy:15m',       40, true, 'other'),
  ('edit-plan:clips:economy:30m',       70, true, 'other'),
  ('edit-plan:clips:economy:60m',      130, true, 'other'),
  ('edit-plan:clips:economy:90m',      190, true, 'other'),
  ('edit-plan:clips:economy:120m',     250, true, 'other'),
  ('edit-plan:clips:economy:180m',     370, true, 'other'),
  ('edit-plan:clips:standard:15m',      80, true, 'other'),
  ('edit-plan:clips:standard:30m',     140, true, 'other'),
  ('edit-plan:clips:standard:60m',     260, true, 'other'),
  ('edit-plan:clips:standard:90m',     380, true, 'other'),
  ('edit-plan:clips:standard:120m',    500, true, 'other'),
  ('edit-plan:clips:standard:180m',    740, true, 'other'),
  ('edit-plan:clips:premium:15m',      160, true, 'other'),
  ('edit-plan:clips:premium:30m',      280, true, 'other'),
  ('edit-plan:clips:premium:60m',      520, true, 'other'),
  ('edit-plan:clips:premium:90m',      760, true, 'other'),
  ('edit-plan:clips:premium:120m',    1000, true, 'other'),
  ('edit-plan:clips:premium:180m',    1480, true, 'other'),
  -- ── chapters (no flat; identical ladder to tighten) ──
  ('edit-plan:chapters:economy:15m',    30, true, 'other'),
  ('edit-plan:chapters:economy:30m',    60, true, 'other'),
  ('edit-plan:chapters:economy:60m',   120, true, 'other'),
  ('edit-plan:chapters:economy:90m',   180, true, 'other'),
  ('edit-plan:chapters:economy:120m',  240, true, 'other'),
  ('edit-plan:chapters:economy:180m',  360, true, 'other'),
  ('edit-plan:chapters:standard:15m',   60, true, 'other'),
  ('edit-plan:chapters:standard:30m',  120, true, 'other'),
  ('edit-plan:chapters:standard:60m',  240, true, 'other'),
  ('edit-plan:chapters:standard:90m',  360, true, 'other'),
  ('edit-plan:chapters:standard:120m', 480, true, 'other'),
  ('edit-plan:chapters:standard:180m', 720, true, 'other'),
  ('edit-plan:chapters:premium:15m',   120, true, 'other'),
  ('edit-plan:chapters:premium:30m',   240, true, 'other'),
  ('edit-plan:chapters:premium:60m',   480, true, 'other'),
  ('edit-plan:chapters:premium:90m',   720, true, 'other'),
  ('edit-plan:chapters:premium:120m',  960, true, 'other'),
  ('edit-plan:chapters:premium:180m', 1440, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
