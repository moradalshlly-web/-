-- Project dubbing has a separate per-started-minute price. Preserve any
-- administrator override on re-application and leave legacy jobs unchanged.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('elevenlabs-dubbing-v2', 1100, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
