---
node_type: generate-script
generated_at: 2026-09-21T19:12:09.161Z
generated_from: 09788c987
---

# Generate Script

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-script`
**Category:** ai
**Credit cost:** `1-3` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `scenes`, `images`, `dialogue`, `music`, `sfx`, `characters`, `locations`

**Required data fields:**
- `label: string`
- `provider: ScriptProvider`
- `model: string`
- `sceneCount: number`
- `styleGuide: string`
- `structure: "freeform" | "8-step" | "custom"`
- `tone: string`
- `targetLength: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedScript?: GeneratedScript`
- `generatedResults?: GeneratedScriptResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Generate Script",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "sceneCount": 5,
  "styleGuide": "",
  "structure": "freeform",
  "tone": "",
  "targetLength": 60,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_script`

**Input parameters:**
- `prompt`
- `scene_count`
- `tone`
- `target_duration`
- `model`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-script-1",
  "type": "generate-script",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Script",
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "sceneCount": 5,
    "styleGuide": "",
    "structure": "freeform",
    "tone": "",
    "targetLength": 60,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
