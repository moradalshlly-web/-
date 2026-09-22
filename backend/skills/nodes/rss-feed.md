---
node_type: rss-feed
generated_at: 2026-09-21T19:12:08.637Z
generated_from: 09788c987
---

# RSS Feed

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `rss-feed`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `content`

**Default data:**
```json
{
  "label": "RSS Feed",
  "feedUrl": "",
  "itemIndex": 0,
  "extractFields": [
    "title",
    "description"
  ]
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
  "id": "rss-feed-1",
  "type": "rss-feed",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "RSS Feed",
    "feedUrl": "",
    "itemIndex": 0,
    "extractFields": [
      "title",
      "description"
    ]
  }
}
```
<!-- AUTO-GEN:END examples -->
