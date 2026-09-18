---
node_type: add-captions
generated_at: 2026-09-18T07:26:59.160Z
generated_from: 8d392afb1
---

# Add Captions

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `add-captions`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`, `transcript`
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
- `wordLevel?: boolean`
- `look?: CaptionLookId`
- `fontWeight?: number`
- `fontFamily?: SupportedFontName`
- `strokeColor?: string`
- `strokeWidth?: number`
- `highlightColor?: string`
- `uppercase?: boolean`
- `positionY?: number`

**Default data:**
```json
{
  "label": "Add Captions",
  "style": "subtitle",
  "position": "bottom",
  "fontSize": 32,
  "color": "#ffffff",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Burn captions into a video (`add_captions` over MCP). `style` picks one of two render paths:

- **Static** — `subtitle`, the DEFAULT when `style` is omitted: one fixed block of `text`, drawn by FFmpeg for the whole clip. It requires `text`, cannot time words, and takes no look.
- **Kinetic** — `word-highlight`, `tiktok-words`, `karaoke`, `bouncy`, `word-pop`: word-timed, rendered by Remotion. You get one only by passing `style`. Any call carrying `segments[]` is a kinetic (Remotion) render too, whatever its styles.

MCP arguments are snake_case (`font_size`, `position_y`, `auto_transcribe`). The SDK spells every field camelCase (`fontSize`, `positionY`, `autoTranscribe`). REST is camelCase too EXCEPT two fields that stay snake_case on the wire: `auto_transcribe` and `transcribe_provider` (a camelCase `autoTranscribe` sent to REST is silently dropped). One carve-out: a caption entry is `{ text, startMs, endMs }` — camelCase on EVERY surface, also inside `segments[]` — while a segment's own range is `start_ms` / `end_ms` over MCP.

### Picking a kinetic style — each has its own visibility model

- **`word-highlight`** — the safe choice for a talking clip of any length. ONE balanced line at a time, held through pauses; the highlight moves word to word.
- **`tiktok-words`** — short pages (a little over a second of speech each), each held until the next page starts. The spoken word is recoloured whenever the look has a highlight colour (the default look does).
- **`karaoke`** / **`bouncy`** — draw the WHOLE `captions[]` as one block, visible from the first word's start to the last word's end (karaoke wipes each word, bouncy springs it). Made for a short phrase or a short `segments[]` range; a full transcript becomes a wall of text.
- **`word-pop`** — exactly one word, at 1.4x `font_size`, only during that word's own window. The frame is blank between words BY DESIGN.

### The look in one field

`look` presets the kinetic typography. UNSET = `outline`: Montserrat 900, UPPERCASE, white on a black outline auto-sized to the font, yellow (`#FFE600`) spoken word — the TikTok / CapCut read with nothing else to set. `look: "clean"` opts out (Inter, no outline, no casing). `font_family`, `font_weight` (100–900 in 100s), `stroke_color`, `stroke_width`, `highlight_color` and `uppercase` each override ONE field of the chosen look and leave the rest: with the default look, `highlight_color` alone keeps the caps and outline and only recolours the spoken word. `stroke_width: 0` removes the outline.

### Where the words come from — choose by how much the on-screen text matters

1. **`captions[]` — you own the text.** One entry per WORD. Use it whenever the text MUST be right: brand and product names, scripted ads, anything a client signs off. Supplying it means this node runs no speech-to-text of its own. Take the timings from `transcribe` and correct the words (recipe below).
2. **Auto-transcribe** (`auto_transcribe`, on by default when a kinetic render has no `captions[]`) — one call, but the text is whatever the engine heard. Fine for casual speech, wrong for names.
3. **`text`** — the only source for `subtitle`. On a kinetic style it is a FALLBACK, not a source: transcription still runs (pass `auto_transcribe: false` to stop it), and text-only words are spaced evenly across the clip, not synced to the speech.
4. **A wired Transcript** — canvas / REST only: the `transcript` input handle (REST field `transcript`, plus `wordLevel`), fed from the `json` output of a `transcribe` or `apply-edl` node, kinetic styles only. The MCP tool has no such argument — pass `captions[]`.

### Recipe — TikTok-style captions from my own script

1. `transcribe` the clip — pass the video's URL (`outputUrl` from `get_job`) as `audio_url` — and wait for the job.
2. Read `words` from its output (`json.words` is the same list) — already `{ text, startMs, endMs }` per word.
3. Correct only the misheard `text` values against your script. Keep every `startMs` / `endMs`, and keep the single leading space each word after the first carries.
4. Burn them in — leaving `look` unset already gives the outline look:

```json
{
  "video_asset_id": "<video job id>", "style": "word-highlight", "font_size": 72, "position_y": 65,
  "auto_transcribe": false,
  "captions": [
    { "text": "Nodaro", "startMs": 120, "endMs": 560 },
    { "text": " makes", "startMs": 560, "endMs": 840 }
  ]
}
```

### Recipe — a big intro phrase, then a word-by-word body (`segments[]`)

```jsonc
{
  "video_asset_id": "<video job id>", "style": "word-highlight", "font_size": 64,
  "captions": [ /* every word of the clip, as above */ ],
  "segments": [
    { "start_ms": 0, "end_ms": 2500, "style": "karaoke", "position": "top", "font_size": 96, "text": "STOP SCROLLING" },
    { "start_ms": 2500, "end_ms": 24000 }   // the clip's own length in ms — never past it
  ]
}
```

The intro carries its own words. The body names none, so it takes the shared `captions[]` (or the auto-transcript) filtered to its range, and inherits the top-level style, size and look.

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
- `look`
- `font_family`
- `font_weight`
- `stroke_color`
- `stroke_width`
- `highlight_color`
- `uppercase`
- `position_y`
- `segments`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Look levers are refused on `subtitle`.** `look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `highlight_color`, `uppercase` or `position_y` on `style: "subtitle"` with no `segments[]` is a 400 `validation_error` — never a silent no-op. `color` / `background_color` work on every style. With `segments[]` the whole render is Remotion, so any style takes any lever.
- **`font_size` is measured against the look's face.** It is px in the source video's own frame (default 32 — small on a 1080-wide vertical clip). `word-highlight` fits a line to ~85 % of the frame width, and `outline` (wide, heavy, caps) spends ~30 % more width per character than `clean`: at 1080 px wide and `font_size: 72` a line holds ~17 characters under `outline`, ~22 under `clean`, ~24 under `outline` + `font_family: "Bebas Neue"`. To fit more words per line: `look: "clean"`, a condensed face (`Bebas Neue`, `Anton`, `Oswald`), or a smaller `font_size`.
- **`word-highlight` is line-based.** A line closes on a sentence end (`.` `!` `?` `…`), a pause ≥ 0.5 s, or the width budget; a phrase split for width is re-balanced so no word is widowed. The line stays up until the next line starts, at most 1.5 s into silence. A word's `startMs` / `endMs` is its SPOKEN window: it times the highlight (which rests on the last-spoken word through a pause), not whether text is on screen — do not stretch `endMs` to "fill the gaps".
- **Word delimiter and order.** Every word after the first carries ONE leading space — exactly what `transcribe` returns, so keep it when you correct a word. `word-highlight` / `karaoke` / `bouncy` also space bare words, but `tiktok-words` pages ON that space: bare words collapse into a single page holding every word. Keep entries in time order — only `word-highlight` sorts; `karaoke` / `bouncy` / `tiktok-words` read the array as given.
- **Position (kinetic).** `top` = the block's TOP edge 12 % down, growing downward; `bottom` = the block's BOTTOM edge at 82 % of the height (clear of the TikTok / Reels UI), growing upward; `center` = 50 %. `position_y` (0–100) is the block's CENTRE and overrides `position`: ~65 sits below a face and above the app UI, while 100 centres the text ON the bottom edge, half off-screen.
- **`segments[]` cascade.** A segment with no `look` inherits the top-level look AND every top-level lever. A segment that names its OWN `look` starts fresh from that preset — the top-level `font_family` / `font_weight` / `stroke_*` / `highlight_color` / `uppercase` do NOT carry over — yet it still inherits `style`, `font_size`, `color`, `background_color`, `position` and `position_y`. A segment that sets its own `position` does NOT inherit the top-level `position_y` (an inherited value never beats a placement the segment asked for); a segment with no placement of its own inherits both. Overlapping segments are a 400.
- **A segment's `captions[]` use ABSOLUTE video-timeline ms**, not ms relative to `start_ms`, and only words whose START falls inside the range are kept — the same rule that deals shared words to segments, so a word never straddles two treatments. Keep every `end_ms` / `endMs` within the clip: the output is lengthened to cover the latest one. A `subtitle` segment shows its `text` (or the range's shared words) as one phrase block; `\n` forces a line break.
- **`transcribe_provider: "whisper"` returns no word timings.** On a kinetic or segmented render with no `captions[]` and no `text` it is a 400 before any credit is reserved; with `text` the transcription is skipped and the text is spaced evenly. Leave the field unset, or name a word-timed engine (`elevenlabs-stt`, `incredibly-fast-whisper`).
- **Billing.** Any kinetic style, and any call with `segments[]`, bills at the kinetic rate rather than the static `subtitle` rate; the look levers add nothing. Supplying `captions[]` skips this node's built-in transcription — a separate `transcribe` call is its own job.

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
    "fontSize": 32,
    "color": "#ffffff",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
