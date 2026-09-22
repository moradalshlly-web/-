---
node_type: tone
generated_at: 2026-09-21T19:12:08.743Z
generated_from: 09788c987
---

# Tone

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `tone`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `tone`

**Required data fields:**
- `label: string`
- `tone: string`

**Default data:**
```json
{
  "label": "Tone",
  "tone": ""
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
  "id": "tone-1",
  "type": "tone",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Tone",
    "tone": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
