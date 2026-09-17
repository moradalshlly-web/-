-- Silence Detect node (silence-detect): one local FFmpeg `silencedetect` pass
-- over an audio/video source's audio proxy, emitting the silent spans as JSON.
--
-- Pricing: flat 1 credit per run, regardless of source length or the number of
-- ranges found (the pass is a local analysis with no external provider cost).
-- Keyless — community installs run it. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts. No composites (the cost never varies).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('silence-detect', 1)
ON CONFLICT (model_identifier) DO NOTHING;
