---
node_type: remove-audio
generated_at: 2026-09-21T19:12:09.814Z
generated_from: 09788c987
---

# Remove Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `remove-audio`
**Category:** processing
**Credit cost:** `20` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Remove Audio",
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
  "id": "remove-audio-1",
  "type": "remove-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Remove Audio",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
