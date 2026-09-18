---
"@nodaro/sdk": minor
"@nodaro/shared": patch
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

The EDL / transcript / result vocabulary (`Edl`, `Transcript`, `EditPlanMode`,
`EditPlanTier`, `EdlClipSet`, `ChapterSet`, `SilenceRanges`) and the
`unwrapEditPlanOutput` result-normalizer are re-exported for one-dependency use.
Additive — no existing surface changes.

The `@nodaro/shared` patch bump carries no source change: it exists only to lift
the SDK's `@nodaro/shared` floor to a version that ships `edl.ts`. The new
resource static-imports `remapTranscriptThroughEdl` / `unwrapEditPlanOutput` from
`@nodaro/shared`, so pairing this SDK with an older shared (pre-`edl.ts`) would
fail the whole SDK at import — the changeset rewrites the dependency range so a
consumer can never resolve that stale sibling.
