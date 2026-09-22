---
node_type: x-post
generated_at: 2026-09-21T19:12:10.630Z
generated_from: 09788c987
---

# X Post

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `x-post`
**Category:** output
**Credit cost:** `10` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Default data:**
```json
{
  "label": "X Post",
  "platform": "x",
  "action": "post-tweet",
  "caption": "",
  "fieldMappings": {}
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
  "id": "x-post-1",
  "type": "x-post",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "X Post",
    "platform": "x",
    "action": "post-tweet",
    "caption": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
