---
"@nodaro/sdk": minor
---

Add the `edit` resource for the phase-1 editorial (podcast-editing) primitives.
`client.edit` exposes:

- `silenceDetect(input)` → `POST /v1/silence-detect` — detect silence ranges in
  an audio/video source (keyless ffmpeg pass).
- `applyEdl(input)` → `POST /v1/apply-edl` — render an edit decision list into a
  video or audio cut, with optional positional source overrides, a transcript to
  remap, output/quality and a default crossfade.
- `editPlan(input)` → `POST /v1/edit-plan` (Cloud edition) — plan a
  transcript-driven cut / clips / chapters from a timed transcript and media
  sources.
- `remapTranscript(edl, transcript)` — a PURE client-side helper (no request)
  that runs `@nodaro/shared`'s `remapTranscriptThroughEdl`.

The EDL / transcript vocabulary (`Edl`, `Transcript`, `EditPlanMode`,
`EditPlanTier`) is re-exported from `@nodaro/shared` for one-dependency use.
Additive — no existing surface changes.
