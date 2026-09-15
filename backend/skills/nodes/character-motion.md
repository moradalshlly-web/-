---
node_type: character-motion
generated_at: 2026-09-15T17:56:51.636Z
generated_from: 59f72b270
---

# Character Motion

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `character-motion`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `target`, `partner`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `characterMotion: string | string[]`

**Optional data fields:**
- `position?: CharacterMotionPosition`
- `pace?: CharacterMotionPace`
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("character-motion")` (MCP) or `GET /v1/picker-catalogs/character-motion` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Character Motion",
  "characterMotion": "auto",
  "position": "auto",
  "pace": "auto"
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
  "id": "character-motion-1",
  "type": "character-motion",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Character Motion",
    "characterMotion": "auto",
    "position": "auto",
    "pace": "auto"
  }
}
```
<!-- AUTO-GEN:END examples -->
