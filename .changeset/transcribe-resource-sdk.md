---
"@nodaro/sdk": minor
---

Add `client.audio.transcribe(input)` — the SDK's first way to reach
`POST /v1/transcribe`.

`transcribe({ audioUrl, provider?, language?, diarize?, tagAudioEvents?,
wordTimestamps? })` returns a job id to poll. `provider` is typed as
`TranscribeProvider` (the ENABLED enum from `@nodaro/shared`), which holds all
three engines the route serves. The types do not pick for you, so the JSDoc
does: `elevenlabs-stt` is always word-level and is the lane that honours
`diarize` / `tagAudioEvents`, `incredibly-fast-whisper` returns word timings when
asked, and `whisper` returns none at all — named explicitly or reached by
omitting `provider`, which still falls back to it. Asking `whisper` for word
timings is a `400` at ingress, before any credit is spent.

`TranscribeProvider` itself is re-exported from `@nodaro/shared` (same pattern
as `AudioFxPreset`), so a consumer can name the type without a second
dependency.

Two new exported result types describe what comes back on the job:
`TranscribeWord` (one word: `text`/`startMs`/`endMs`, plus `speaker` on a
diarized run) and `TranscribeJobOutput` (`text`, `language`, `words`, `json` —
the normalized `Transcript` — and `segments`). The units are the trap and are
documented on both: `words` and `json` are in MILLISECONDS, the top-level
`segments` are in SECONDS.

`TranscribeWord` is deliberately the same shape as `media.addCaptions()`'s
`CaptionEntry`, so a transcribe job's `output_data.words` can be handed to
`addCaptions({ captions, autoTranscribe: false })` verbatim — correct a word's
`text` in between and the correction is what burns in. `addCaptions`' JSDoc
gained one sentence pointing at that composition and at the fact that a word's
`startMs`/`endMs` is its SPOKEN window (what times the `word-highlight`
highlight), not how long its line is on screen.

Additive — no existing surface changes.
