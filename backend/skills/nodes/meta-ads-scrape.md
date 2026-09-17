---
node_type: meta-ads-scrape
generated_at: 2026-09-17T18:20:12.464Z
generated_from: 112680126
---

# Meta Ads

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `meta-ads-scrape`
**Category:** input
**Credit cost:** 20
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`, `text`, `image`, `video`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `mode?: import("@nodaro/shared").MetaAdsNodeMode`
- `query?: string`
- `pageUrls?: string`
- `advertisers?: import("@nodaro/shared").MetaAdsAdvertiser[]`
- `count?: number`
- `period?: import("@nodaro/shared").MetaAdsScrapePeriod`
- `activeStatus?: import("@nodaro/shared").MetaAdsScrapeStatus`
- `countryCode?: string`
- `platforms?: string[]`
- `formats?: string[]`
- `featuredIndex?: number`
- `viewFormat?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedJson?: unknown`
- `lastRunOutcome?: "success" | "empty" | "failed"`
- `lastRunAt?: number`
- `lastRunCount?: number`
- `lastRunStartedAt?: number`
- `lastRunFingerprint?: string`
- `lastGoodAt?: number`
- `lastGoodCount?: number`

**Default data:**
```json
{
  "label": "Meta Ads",
  "mode": "search",
  "query": "",
  "count": 20,
  "period": "30d",
  "activeStatus": "active",
  "countryCode": "ALL"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "meta-ads-scrape-1",
  "type": "meta-ads-scrape",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Meta Ads",
    "mode": "search",
    "query": "",
    "count": 20,
    "period": "30d",
    "activeStatus": "active",
    "countryCode": "ALL"
  }
}
```
<!-- AUTO-GEN:END examples -->
