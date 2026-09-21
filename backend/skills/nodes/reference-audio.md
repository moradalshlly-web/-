---
node_type: reference-audio
generated_at: 2026-09-21T18:20:26.342Z
generated_from: b40e2db40
---

# Reference Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `reference-audio`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `sourceType: "youtube" | "upload" | "url"`
- `youtubeUrl: string`
- `uploadedFileUrl: string`
- `directUrl: string`
- `videoTitle: string`
- `videoThumbnail: string`
- `videoDuration: string`
- `extractedAudioUrl: string`
- `extractionStatus: "idle" | "extracting" | "ready" | "failed"`

**Optional data fields:**
- `metadata?: { durationSeconds?: number; mediaUrl?: string }`

**Default data:**
```json
{
  "label": "Reference Audio",
  "sourceType": "youtube",
  "youtubeUrl": "",
  "uploadedFileUrl": "",
  "directUrl": "",
  "videoTitle": "",
  "videoThumbnail": "",
  "videoDuration": "",
  "extractedAudioUrl": "",
  "extractionStatus": "idle"
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
  "id": "reference-audio-1",
  "type": "reference-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Reference Audio",
    "sourceType": "youtube",
    "youtubeUrl": "",
    "uploadedFileUrl": "",
    "directUrl": "",
    "videoTitle": "",
    "videoThumbnail": "",
    "videoDuration": "",
    "extractedAudioUrl": "",
    "extractionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
