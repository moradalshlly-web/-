---
node_type: motion
generated_at: 2026-09-21T19:12:08.794Z
generated_from: 09788c987
---

# Motion

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `motion`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `motion: "subtle" | "moderate" | "dynamic"`

**Default data:**
```json
{
  "label": "Motion",
  "motion": "moderate"
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
  "id": "motion-1",
  "type": "motion",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Motion",
    "motion": "moderate"
  }
}
```
<!-- AUTO-GEN:END examples -->
