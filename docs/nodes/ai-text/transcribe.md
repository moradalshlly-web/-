# Transcribe
> Convert spoken audio to text with optional speaker diarization and audio event tagging.

## Overview

The Transcribe node converts audio into a text transcript. The engine is ElevenLabs Speech-to-Text — the node's default and the only one the editor's picker offers today. Two Replicate-hosted engines, Whisper and Incredibly Fast Whisper, remain implemented and are still reachable through a node's `provider` written directly into workflow JSON (an agent, an import, a template) and through Add Captions' `transcribe_provider`; see [Word timestamps: which engine can do it](#word-timestamps-which-engine-can-do-it). The node supports automatic language detection or explicit language selection, speaker diarization (identifying who said what), and audio event tagging (labeling non-speech sounds like music, laughter, or applause).

The node has two output handles: a **`text`** handle carrying the plain transcript, and a **`json`** handle carrying a normalized **Transcript** object with word- and segment-level timings. The `json` handle is the structured form the caption and editing nodes consume; the `text` handle is unchanged from earlier versions, so existing wires keep working.

On a self-hosted install the chosen engine runs on your own key (`ELEVENLABS_API_KEY` for ElevenLabs STT, `REPLICATE_API_TOKEN` for the Whisper engines). With no key for the chosen engine and a connected nodaro.ai account, the transcription runs through the connection instead; with neither, the node fails with a message naming the key to add.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `TranscribeProvider` | `"elevenlabs-stt"` | Transcription engine — `elevenlabs-stt`, `incredibly-fast-whisper`, or `whisper`. Only the first two return **word timestamps**; `whisper` never does — see [below](#word-timestamps-which-engine-can-do-it) |
| Language | `string` | `"auto"` | Language code for the audio, or "auto" for automatic detection. Supports 20+ languages |
| Speaker Diarization | `boolean` | `false` | When enabled, identifies and labels different speakers in the transcript |
| Tag Audio Events | `boolean` | `false` | When enabled, annotates non-speech audio events (music, laughter, applause, etc.) in the transcript |

## Inputs & Outputs

- **Input**: `audio` -- audio file to transcribe
- **Output**: `text` -- full transcript text string
- **Output**: `json` -- a normalized `Transcript` object (word/segment timings)

### The `json` output: `Transcript`

The `json` handle emits a `Transcript` — the shared, versioned shape the caption and editing nodes read:

```ts
Transcript {
  version: 1
  sourceId?: string        // set when the transcript is bound to an editing source
  language?: string
  words: Array<{
    text: string
    startMs: number        // milliseconds
    endMs: number          // milliseconds
    speaker?: string       // present on diarized runs
    confidence?: number
  }>
  segments?: Array<{
    startMs: number
    endMs: number
    text: string
    speaker?: string
  }>
}
```

All timings are integer **milliseconds**. `words` is populated whenever word-level timing is available — always for the default ElevenLabs engine (it is word-level), and for `incredibly-fast-whisper` when the `json` handle is connected (the node then requests word timestamps automatically). `segments` carries the coarser sentence/chunk breakdown when the engine provides one.

### Word timestamps: which engine can do it

| Engine | Word timestamps | Notes |
|--------|-----------------|-------|
| `elevenlabs-stt` (default) | Yes, always | Word-level by design — the flag changes nothing |
| `incredibly-fast-whisper` | Yes, on request | Switches the model to word-granularity timestamps |
| `whisper` | **No** | `openai/whisper` has no word-timestamps input at all |

`whisper` cannot produce word timings under any setting. Asking it for them used
to return an empty word list from a job that reported success; an explicit
request is now **refused** instead, and an *inferred* one is simply not made.

**Over `POST /v1/transcribe`,** `provider` currently accepts exactly one value:
`elevenlabs-stt`.

- Naming any other engine — `provider: "whisper"`, `provider:
  "incredibly-fast-whisper"` — is a `400 validation_error` on **`provider`**:
  those lanes are not in the route's enum at all, so such a request never
  reaches the word-timestamps rule.
- **Omitting `provider`** falls back to the legacy `whisper` lane, and that is
  the only way to reach the word-timestamps refusal from REST: `wordTimestamps:
  true` with no `provider` returns `400 validation_error` on
  **`wordTimestamps`**, naming the engine to set instead. Pass `provider:
  "elevenlabs-stt"` and the same call succeeds.
- Either rejection lands before the job is created, so nothing is charged. The
  engine is never silently swapped — that would change what you pay for without
  asking.

**Where `incredibly-fast-whisper` and `whisper` *are* selectable:** inside a
workflow run, never over `POST /v1/transcribe`.

- A **Transcribe node** runs whatever `provider` its node data carries. The
  editor's picker only offers ElevenLabs STT, so the whisper lanes reach a run
  only through workflow JSON written by an agent, an import, or a template.
- **Add Captions** takes a `transcribe_provider` of `elevenlabs-stt`,
  `incredibly-fast-whisper` (its default) or `whisper` — on `POST
  /v1/add-captions`, in the MCP `add_captions` tool, and in its node data. See
  [Add Captions](../processing-video/add-captions.md#the-auto-transcribe-engine-transcribe_provider).

**What happens on a run:**

- The MCP `transcribe` tool always runs `elevenlabs-stt`, so its result always
  carries `output_data.json.words`.
- A run with the `json` handle connected asks for word timings automatically —
  but only when the node's engine can deliver them. On `whisper` the request is
  simply not made: the run completes with a segments-only transcript whose
  `words` list is empty, exactly as it did before word timings existed. Pick
  `elevenlabs-stt` (the default) or `incredibly-fast-whisper` when you need the
  word timings.
- If an engine that *should* deliver word timings returns none — or returns
  sentence-level timings where word-level was requested — for audio that clearly
  has speech, the job fails and refunds rather than handing back timings that
  cannot do what was asked. Audio with no speech at all still succeeds with no
  words, including an audio-event-only clip that transcribes as `[music]`.

### Composing into burned-in captions

The node feeds Add Captions two ways:

1. **Wire the `json` handle into Add Captions.** The node requests word timings
   automatically, and Add Captions renders them as word-aligned kinetic captions.
2. **Pass the words through the API.** A finished transcribe job's
   `output_data.words` is already the caption shape (`text`, `startMs`, `endMs`)
   — hand it straight to `POST /v1/add-captions` as `captions[]`:

   ```
   POST /v1/transcribe   { audioUrl, provider: "elevenlabs-stt", wordTimestamps: true }
     → poll GET /v1/jobs/:id → output_data.words
   POST /v1/add-captions { videoUrl, style: "word-highlight", captions: <those words> }
   ```

   Supplying `captions[]` also means Add Captions runs no transcription of its
   own, so nothing is transcribed (or billed) twice.

### Text output details

The `text` handle and `{Label}` references resolve the plain transcript, exactly as before:

| Field | Type | Description |
|-------|------|-------------|
| generatedText | `string` | The full transcript as plain text |
| generatedResults | `array` | Array of result objects, each containing `text`, `language`, `jobId`, `timestamp`, and the per-result `transcript` |

When Speaker Diarization is enabled, the transcript includes speaker labels (e.g., "Speaker 1:", "Speaker 2:") before each segment, and each word in the `Transcript` carries its `speaker`.

When Tag Audio Events is enabled, non-speech sounds are annotated inline (e.g., "[music]", "[laughter]").
## Best Practices

- Use auto-detect for language unless you know the audio is in a specific language. Explicit language selection can improve accuracy for languages that sound similar.
- Enable Speaker Diarization when the audio contains multiple speakers (interviews, meetings, podcasts) to get labeled segments.
- Enable Tag Audio Events when the audio context matters (e.g., transcribing a video where background sounds are relevant to understanding).
- For best accuracy, use clean audio. Consider running the Voice Extractor node upstream if the source has significant background noise.
- Shorter audio segments transcribe more reliably. For very long audio, consider splitting into segments first.

## Common Use Cases

- Transcribing interview or podcast audio for written content
- Generating subtitles and captions from video audio tracks
- Converting voice memos or meeting recordings to text
- Creating searchable text archives from audio libraries
- Feeding transcripts into downstream AI nodes for summarization or analysis

## Tips

- The `text` output connects to any text-consuming node. Common downstream connections include Generate Text (for summarization), Combine Text (for assembly), and Add Captions (for subtitle generation).
- The `json` output connects to nodes that read a structured `Transcript` — for example Add Captions (for word-aligned subtitles) and the editing nodes. Because it carries per-word timings, it does not need a separate alignment pass.
- Speaker diarization and audio event tagging are independent options -- you can enable one, both, or neither.
- The transcription is processed asynchronously via the backend worker queue. Progress is shown in the node during execution.
- Language auto-detection works across the full set of supported languages. The explicit language dropdown provides 20+ language options matching the ElevenLabs STT model's capabilities.
- For word-level timestamps, connect the `json` output — it already carries per-word timings on `elevenlabs-stt` (the node's engine) and on `incredibly-fast-whisper` where that lane is in use; on `whisper` the timings are segment-level only. The Forced Alignment node remains available for realigning an externally supplied transcript to audio.
