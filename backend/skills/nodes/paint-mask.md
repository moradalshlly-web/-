---
node_type: paint-mask
generated_at: 2026-09-21T19:12:10.099Z
generated_from: 09788c987
---

# Paint Mask

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `paint-mask`
**Category:** processing
**Credit cost:** `0` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `image`, `mask`
**Outputs (source handles):** `mask`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `maskUrl?: string`
- `sourceImageUrl?: string`
- `maskUpdatedAt?: number`
- `defaultBrushSize?: number`
- `defaultBrushHardness?: number`

**Default data:**
```json
{
  "label": "Paint Mask",
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
  "id": "paint-mask-1",
  "type": "paint-mask",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Paint Mask",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
