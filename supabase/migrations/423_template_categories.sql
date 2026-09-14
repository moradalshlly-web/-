-- Marketplace templates are filed under one of eight use cases: product-imagery,
-- static-ads, user-generated-content, video-ads, brand-assets, automations,
-- campaign-concepts, social-creatives. Re-file every template from the previous
-- taxonomy. The map mirrors LEGACY_TEMPLATE_CATEGORIES in
-- packages/shared/src/template-categories.ts, which the API keeps for links and
-- rows this migration has not reached. Idempotent: rows already on the new list
-- are left alone. Published apps keep their own category list — untouched here.
UPDATE public.workflow_templates
SET category = CASE category
  WHEN 'image-generation' THEN 'product-imagery'
  WHEN 'video-production' THEN 'video-ads'
  WHEN 'audio-music'      THEN 'social-creatives'
  WHEN 'content-writing'  THEN 'campaign-concepts'
  WHEN 'social-media'     THEN 'social-creatives'
  WHEN 'data-processing'  THEN 'automations'
  WHEN 'multi-step'       THEN 'automations'
  ELSE 'automations'
END
WHERE category IS NULL
   OR category NOT IN (
     'product-imagery', 'static-ads', 'user-generated-content', 'video-ads',
     'brand-assets', 'automations', 'campaign-concepts', 'social-creatives'
   );
