-- Meta Ads scraper node (meta-ads-scrape): optional per-ad AI analysis (the
-- "expert competitor ad analyst" pass), priced per REQUESTED ad by the
-- analysing model's tier and folded into the scrape's tiered identifier so
-- every quote stays ONE SKU:
--
--   meta-ads-scrape:<tier>:analysis           = tier × (1 + 3)   (standard models)
--   meta-ads-scrape:<tier>:analysis:economy   = tier × (1 + 1)
--   meta-ads-scrape:<tier>:analysis:premium   = tier × (1 + 4)
--
-- The per-ad rows (meta-ads-analysis[:economy|:premium]) price the
-- settlement: a run commits tier + per-ad × ads ACTUALLY analysed and refunds
-- the rest. The formula and the tier set live in
-- packages/shared/src/meta-ads-scrape.ts; mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-analysis', 3)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-analysis:economy', 1)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-analysis:premium', 4)
ON CONFLICT (model_identifier) DO NOTHING;

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:10:analysis', 40)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:10:analysis:economy', 20)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:10:analysis:premium', 50)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:20:analysis', 80)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:20:analysis:economy', 40)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:20:analysis:premium', 100)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:50:analysis', 200)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:50:analysis:economy', 100)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:50:analysis:premium', 250)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:100:analysis', 400)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:100:analysis:economy', 200)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:100:analysis:premium', 500)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:200:analysis', 800)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:200:analysis:economy', 400)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:200:analysis:premium', 1000)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:500:analysis', 2000)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:500:analysis:economy', 1000)
ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('meta-ads-scrape:500:analysis:premium', 2500)
ON CONFLICT (model_identifier) DO NOTHING;
