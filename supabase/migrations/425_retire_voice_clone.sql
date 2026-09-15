-- 425: retire `voice-clone` (ElevenLabs instant voice clone).
--
-- Voice cloning is no longer offered on the platform (product decision,
-- 2026-09-15). The same PR removes it from every surface: the create routes
-- answer 410 `voice_cloning_retired`, the MCP `voice_clone` tool, the catalog
-- entry, STATIC_CREDIT_COSTS, the editor / studio clone forms, the SDK + CLI
-- create paths and the docs. This removes its price row so /admin/models
-- stops listing a model nothing can run.
--
-- The `voice_clones` table and every row in it are deliberately untouched:
-- clones users created before the retirement stay listable, renamable,
-- deletable and usable as text-to-speech / voice-changer voice ids.
-- Idempotent. Re-seed with an INSERT ... ON CONFLICT DO NOTHING if cloning
-- ever returns.
DELETE FROM public.model_pricing
WHERE model_identifier = 'voice-clone';
