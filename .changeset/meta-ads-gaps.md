---
"@nodaro/shared": minor
---

Meta Ads: advertiser mode can be driven by the `in` input — `metaAdsScrapeWireSources` emits `advertiserNames` (resolved to Page urls server-side) when advertiser mode has no picks but upstream text, `splitMetaAdsAdvertiserNames` parses one-name-per-line/comma input, and `resolveMetaAdsScrapeCreditId` counts those names as billable sources.
