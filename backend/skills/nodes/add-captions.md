---
node_type: add-captions
generated_at: 2026-09-17T21:28:25.414Z
generated_from: 5fbf9f883
---

# Add Captions

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `add-captions`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `style: CaptionStyle`
- `position: "bottom" | "top" | "center"`
- `fontSize: number`
- `color: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `autoTranscribe?: boolean`
- `transcribeProvider?: "whisper" | "incredibly-fast-whisper" | "elevenlabs-stt"`

**Default data:**
```json
{
  "label": "Add Captions",
  "style": "subtitle",
  "position": "bottom",
  "fontSize": 24,
  "color": "#ffffff",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `add_captions`

**Input parameters:**
- `text`
- `captions`
- `auto_transcribe`
- `transcribe_provider`
- `video_url`
- `video_asset_id`
- `style`
- `position`
- `font_size`
- `color`
- `background_color`
- `font_family`
- `stroke_color`
- `stroke_width`
- `highlight_color`
- `uppercase`
- `position_y`
- `segments`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "add-captions-1",
  "type": "add-captions",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Add Captions",
    "style": "subtitle",
    "position": "bottom",
    "fontSize": 24,
    "color": "#ffffff",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
