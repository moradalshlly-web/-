---
node_type: video-audit
generated_at: 2026-09-21T19:12:09.630Z
generated_from: 09788c987
---

# AI Audit

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-audit`
**Category:** processing
**Credit cost:** `215-1924` per `GET /v1/nodes` — the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `video`, `analysis`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `videoUrl?: string`
- `probedVideo?: { url: string; durationSec: number }`
- `lastAuditReport?: VideoAuditReport`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: VideoAnalysisResult`

**Default data:**
```json
{
  "label": "AI Audit",
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
  "id": "video-audit-1",
  "type": "video-audit",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "AI Audit",
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
