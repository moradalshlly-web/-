---
node_type: combine-text
generated_at: 2026-09-21T19:12:10.250Z
generated_from: 09788c987
---

# Combine Text

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `combine-text`
**Category:** utility
**Credit cost:** `0` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `text`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `separator: "newline" | "comma" | "space" | "double-newline" | "stars" | "custom"`
- `customSeparator: string`
- `combinedText: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Combine Text",
  "separator": "newline",
  "customSeparator": "",
  "combinedText": ""
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
  "id": "combine-text-1",
  "type": "combine-text",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Combine Text",
    "separator": "newline",
    "customSeparator": "",
    "combinedText": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
