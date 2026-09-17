-- Meta Ads scraper node (meta-ads-scrape): pull public Facebook + Instagram
-- ads from Meta's Ad Library by keyword or Facebook Page.
--
-- Pricing: 1 credit per REQUESTED ad, rounded UP to a tier of the requested
-- total (count × sources). The formula and the tier set live in
-- packages/shared/src/meta-ads-scrape.ts; the bare identifier is the pre-Zod
-- credit-guard fallback (mid tier, never the max). Mirrors STATIC_CREDIT_COSTS
-- in backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape', 20)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:10', 10)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:20', 20)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:50', 50)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:100', 100)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:200', 200)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:500', 500)
ON CONFLICT (model_identifier) DO NOTHING;
