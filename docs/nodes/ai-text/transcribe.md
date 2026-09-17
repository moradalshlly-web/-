# Transcribe
> Convert spoken audio to text with optional speaker diarization and audio event tagging.

## Overview

The Transcribe node converts audio into a text transcript. Three engines are selectable: ElevenLabs Speech-to-Text (the default), Whisper, and Incredibly Fast Whisper (both Replicate-hosted). It supports automatic language detection or explicit language selection, speaker diarization (identifying who said what), and audio event tagging (labeling non-speech sounds like music, laughter, or applause).

The node has two output handles: a **`text`** handle carrying the plain transcript, and a **`json`** handle carrying a normalized **Transcript** object with word- and segment-level timings. The `json` handle is the structured form the caption and editing nodes consume; the `text` handle is unchanged from earlier versions, so existing wires keep working.

On a self-hosted install the chosen engine runs on your own key (`ELEVENLABS_API_KEY` for ElevenLabs STT, `REPLICATE_API_TOKEN` for the Whisper engines). With no key for the chosen engine and a connected nodaro.ai account, the transcription runs through the connection instead; with neither, the node fails with a message naming the key to add.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `TranscribeProvider` | `"elevenlabs-stt"` | Transcription engine — `elevenlabs-stt`, `whisper`, or `incredibly-fast-whisper` |
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

All timings are integer **milliseconds**. `words` is populated whenever word-level timing is available — always for the default ElevenLabs engine (it is word-level), and for the two Whisper engines when the `json` handle is connected (the node then requests word timestamps automatically). `segments` carries the coarser sentence/chunk breakdown when the engine provides one.

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
- For word-level timestamps, connect the `json` output — it already carries per-word timings. The Forced Alignment node remains available for realigning an externally supplied transcript to audio.
