---
"@nodaro/shared": minor
---

Transcribe: a capability table for word timestamps.

`@nodaro/shared` gains `TRANSCRIBE_LANES`, `TranscribeLane`, `TRANSCRIBE_PROVIDER_CAPABILITIES`, `transcribeProvidersWithWordTimestamps()`, `transcribeLaneSupportsWordTimestamps()`, `DEFAULT_TRANSCRIBE_PROVIDER`, and `DEFAULT_TRANSCRIBE_NODE_PROVIDER`. `TRANSCRIBE_LANES` is the superset of `TRANSCRIBE_PROVIDERS` covering every transcription lane the platform implements (including the two Replicate lanes hidden from the user-facing enum but still reachable through the route default and add-captions' internal auto-transcribe). The capability table records which lanes return per-word timings: `openai/whisper` does not (it has no `word_timestamps` input in any published version, so the key is silently dropped), while `incredibly-fast-whisper` and `elevenlabs-stt` do. Callers ask the table instead of matching on a provider name — `transcribeLaneSupportsWordTimestamps(lane)` answers it for an UNTRUSTED lane id (node data, an imported workflow, a wire body), returning `false` for anything it has never heard of rather than throwing.

`DEFAULT_TRANSCRIBE_NODE_PROVIDER` is the lane a transcribe NODE with no `provider` resolves to (`elevenlabs-stt`), deliberately distinct from `DEFAULT_TRANSCRIBE_PROVIDER`, which is the `/v1/transcribe` route's legacy fallback for an absent `provider` (`whisper`) and is kept only so a pre-existing REST caller keeps billing the same id.

Structural vocabulary only — no creative content, no pricing, no behaviour change inside the package.
