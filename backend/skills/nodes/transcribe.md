---
node_type: transcribe
generated_at: 2026-09-17T19:59:19.694Z
generated_from: b3e49a12f
---

# Transcribe

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `transcribe`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `audio`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `provider: TranscribeProvider`
- `language: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `diarize?: boolean`
- `tagAudioEvents?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string; transcript?: Transcript }>`
- `generatedJson?: Transcript`
- `activeResultIndex?: number`
- `wordTimestamps?: boolean`

**Default data:**
```json
{
  "label": "Transcribe",
  "provider": "elevenlabs-stt",
  "language": "auto",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Speech to text WITH timings (`transcribe` over MCP): the transcript of an audio or video file, plus a start/end for every word. It is the timing source for everything downstream that is word-timed — `add_captions` `captions[]`, `plan_edit`, `apply_edl` — and the way to get a clip's words before you correct them. A plain media URL works for audio and video alike; a YouTube / TikTok / Instagram / X page URL has its audio extracted first.

MCP arguments are snake_case (`audio_url`, `tag_audio_events`, `word_timestamps`); REST and the SDK spell the same fields camelCase (`audioUrl`, `tagAudioEvents`, `wordTimestamps`). The OUTPUT keys below are identical on every surface.

### Engines — which one gives word timings

- **`elevenlabs-stt`** (ElevenLabs Scribe) — the only enabled engine, the canvas node's default, and what the MCP `transcribe` tool ALWAYS runs. Always word-level, whether or not `word_timestamps` is set (that flag is kept for compatibility and changes nothing here). The only engine with `diarize` and `tag_audio_events`.
- **`whisper`** — a legacy lane this route no longer lets a caller name, but REST still falls back to it when `provider` is OMITTED. It returns text and sentence segments and NO word timings. See the gotcha below.

### Reading the result

Wait for the job, then read its output — `outputData` on `get_job` / `wait_for_job`, `output_data` on the REST job:

| Key | What it is | Unit |
|-----|------------|------|
| `text` | The whole transcript as one string | — |
| `language` | Detected (or requested) language code | — |
| `words` | Caption-shaped words `{ text, startMs, endMs, speaker? }` — omitted when no word was heard | **ms** |
| `json` | The normalized Transcript `{ version, language, words[], segments? }` — always present, `json.words` carries the same words | **ms** |
| `segments` | Sentence segments `{ start, end, text }` — the legacy whisper lane only, never on `elevenlabs-stt` | **SECONDS** |

Which one to hand on:

- **`add_captions`** → `words` (or `json.words`) straight into `captions[]`, with `auto_transcribe: false`. Correct the `text` values first if the on-screen words must be exact.
- **`plan_edit` / `apply_edl`** → the whole `json` object as `transcript`. On the canvas that is the `json` output handle; the `text` handle carries the plain string.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `transcribe`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `language`
- `diarize`
- `tag_audio_events`
- `word_timestamps`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Seconds vs ms.** `words` and everything inside `json` are integer MILLISECONDS. A top-level `segments` array, when there is one, is in SECONDS. Never mix the two clocks; for anything timed, read `json`.
- **REST: always send `provider: "elevenlabs-stt"`.** With `provider` omitted the route runs the legacy `whisper` lane: the job succeeds with `text` and `segments` but `json.words` is `[]` — the "transcribe gave me no words" failure. Asking that lane for `wordTimestamps: true` is a 400 `validation_error` before any credit is reserved, and the message names the engine to use. The MCP tool and the canvas node already send the engine, so they are not affected.
- **`diarize` / `tag_audio_events` are `elevenlabs-stt` only.** Diarized words carry `speaker` (`speaker_0`, `speaker_1`, …). Audio-event tags such as `[laughter]` or `[music]` appear in `text` only — they are never entries in `words`, so a music-only clip legitimately returns `json.words: []`.
- **Speech-to-text mishears names.** Brand names, product names and unusual spellings come back wrong (or split in two). Correct the `text` of the affected entries and KEEP their `startMs` / `endMs` — the timing is right even when the spelling is not. Merging two entries into one word: keep the first `startMs` and the last `endMs`.
- **Word `text` carries its delimiter.** Every word after the first starts with ONE space (`"Nodaro"`, `" makes"`, `" videos"`). Keep it when you edit a word — `add_captions`' `tiktok-words` style pages on that space.
- **`language`** is a short BCP-47 code (`en`, `es`, `he`, max 10 characters); omit it, or pass `auto`, to auto-detect.
- **`audio_asset_id` takes an audio OR a video job id / upload** — a video's speech is transcribed straight from the video, so to caption a generated clip pass that clip's job id (or its URL as `audio_url`). An image id is refused.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "transcribe-1",
  "type": "transcribe",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Transcribe",
    "provider": "elevenlabs-stt",
    "language": "auto",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
