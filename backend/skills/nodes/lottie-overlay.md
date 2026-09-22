---
node_type: lottie-overlay
generated_at: 2026-09-22T09:36:31.451Z
generated_from: 65b4cddf2
---

# Lottie Overlay

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lottie-overlay`
**Category:** processing
**Credit cost:** `5-20` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`, `lottie`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `overlayPrompt: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `overlayPlan?: Record<string, unknown>`
- `inputVideoUrl?: string`
- `width?: number`
- `height?: number`
- `lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Lottie Overlay",
  "overlayPrompt": "",
  "fps": 30,
  "durationSeconds": 10,
  "fieldMappings": {},
  "executionStatus": "idle"
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
  "id": "lottie-overlay-1",
  "type": "lottie-overlay",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lottie Overlay",
    "overlayPrompt": "",
    "fps": 30,
    "durationSeconds": 10,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
