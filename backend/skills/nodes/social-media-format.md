---
node_type: social-media-format
generated_at: 2026-09-21T19:12:09.757Z
generated_from: 09788c987
---

# Social Media Format

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `social-media-format`
**Category:** processing
**Credit cost:** `20` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `media`, `text`
**Outputs (source handles):** `media`, `text`

**Required data fields:**
- `label: string`
- `platform: string`
- `contentType: string`
- `specKey: string`
- `method: "crop" | "pad" | "stretch"`
- `padColor: string`
- `formattedText: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Social Media Format",
  "platform": "instagram",
  "contentType": "feed-square",
  "specKey": "instagram:feed-square",
  "method": "pad",
  "padColor": "#000000",
  "formattedText": "",
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
  "id": "social-media-format-1",
  "type": "social-media-format",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Social Media Format",
    "platform": "instagram",
    "contentType": "feed-square",
    "specKey": "instagram:feed-square",
    "method": "pad",
    "padColor": "#000000",
    "formattedText": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
