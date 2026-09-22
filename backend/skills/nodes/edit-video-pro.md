---
node_type: edit-video-pro
generated_at: 2026-09-21T19:12:09.265Z
generated_from: 09788c987
---

# Edit Video Pro

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `edit-video-pro`
**Category:** ai
**Credit cost:** `100` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `video`, `prompt`, `imageReferences`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: string`
- `mode: "replace"`
- `prompt: string`
- `spanStart: number`
- `spanEnd: number`
- `generateAudio: boolean`

**Optional data fields:**
- `sourceDurationSec?: number`
- `referenceImageUrls?: string[]`
- `fieldMappings?: FieldMappings`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `promptPrefix?: string`
- `promptSuffix?: string`

**Default data:**
```json
{
  "label": "Edit Video Pro",
  "provider": "seedance-2",
  "mode": "replace",
  "prompt": "",
  "spanStart": 0,
  "spanEnd": 8,
  "generateAudio": true,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
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
  "id": "edit-video-pro-1",
  "type": "edit-video-pro",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Edit Video Pro",
    "provider": "seedance-2",
    "mode": "replace",
    "prompt": "",
    "spanStart": 0,
    "spanEnd": 8,
    "generateAudio": true,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
