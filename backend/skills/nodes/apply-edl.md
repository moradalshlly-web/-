---
node_type: apply-edl
generated_at: 2026-09-17T19:57:49.483Z
generated_from: a03903d30
---

# Apply EDL

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `apply-edl`
**Category:** processing
**Credit cost:** 10
**Inputs (target handles):** `edl`, `transcript`, `sources`
**Outputs (source handles):** `media`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `output?: "video" | "audio"`
- `quality?: "proxy" | "final"`
- `crossfadeMs?: number`
- `edl?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedAudioUrl?: string`
- `generatedJson?: unknown`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Apply EDL",
  "output": "video",
  "quality": "final",
  "crossfadeMs": 0,
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
  "id": "apply-edl-1",
  "type": "apply-edl",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Apply EDL",
    "output": "video",
    "quality": "final",
    "crossfadeMs": 0,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
