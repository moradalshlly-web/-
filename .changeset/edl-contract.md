---
"@nodaro/shared": minor
---

Add the EDL (edit decision list) contract — the shared data shape the podcast-editing primitives compose on. New exports from `@nodaro/shared`: `Edl`, `EdlSource`, `EdlSegment`, `EdlLayout`, `EdlRegion`, `EdlClipSet`, `EdlDropped`, `Transcript`, `EDL_VERSION`, and the pure functions `edlDurationMs`, `validateEdl`, `validateEdlClipSet`, `remapMsThroughEdl`, `remapTranscriptThroughEdl`, `speakerTurns`, `normalizeEdl`, `normalizeTranscript`. Structural vocabulary only — no creative content. Times are integer milliseconds; a crossfade overlaps (compresses the timeline); the contract carries a clock, per-source offsets and a per-slot weight so the multicam and speaker-view work can extend it additively.
