-- Voice Changer Pro: make every credit identifier the plugin charges under
-- admin-visible in /admin/models, and re-derive the two that were priced
-- below what they cost to run (analyze, re-speak).
--
--   voice-changer-pro          per started MINUTE of stem audio per speech-
--                              to-speech slot (row already exists at 40 and
--                              is now read as that unit — see
--                              ee/billing/voice-changer-pro-credits.ts)
--   voice-changer-pro-analyze  flat per analysis (separation + diarization)
--   voice-changer-pro-export   flat per export (a stream-copy remux)
--   voice-changer-pro-respeak  per started 1K characters per Re-speak slot,
--                              at parity with the elevenlabs-v3 text-to-speech
--                              identifier that makes the same vendor call
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('voice-changer-pro-analyze', 10, true, 'audio'),
  ('voice-changer-pro-export', 1, true, 'audio'),
  ('voice-changer-pro-respeak', 30, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
