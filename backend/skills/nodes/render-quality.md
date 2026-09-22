---
node_type: render-quality
generated_at: 2026-09-21T19:12:09.133Z
generated_from: 09788c987
---

# Render Quality

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `render-quality`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `renderQuality: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("render-quality")` (MCP) or `GET /v1/picker-catalogs/render-quality` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Render Quality",
  "renderQuality": "raytracing"
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
  "id": "render-quality-1",
  "type": "render-quality",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Render Quality",
    "renderQuality": "raytracing"
  }
}
```
<!-- AUTO-GEN:END examples -->
