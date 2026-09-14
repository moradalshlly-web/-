---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D declares the ADVISORY delivery: a scene the visual reviewer refused, but
that passed every mandatory assertion, is delivered rather than withheld once the
repair budget is spent. The job completes, the video is real, and the refusal
rides along in two places the delivery contract already had.

- `metadata.review` — the whole verdict, typed as `Scene3DReviewVerdict`:
  `{ verdict: "refused", objections: [{ category, what, correction?, frames }], observed? }`.
  There is no `severity` on an objection because severity is the FILTER — only
  blocking findings become objections — and `objections` may legitimately be
  EMPTY, which reports a refusal that named nothing actionable.
- `validation.warnings[]` entries coded `SCENE_REVIEW_REFUSED` (exported as
  `SCENE3D_REVIEW_REFUSED_CODE`) — one per objection, carrying the `shotId` when
  every frame it cites falls inside one shot. Distinct from the `SCENE_QUALITY_*`
  codes, which appear on a job that FAILED.

`validation.status` stays `"passed"` on an advisory delivery, so the new
`scene3DReviewVerdictOf(output)` helper is the reader to use: testing the status,
or counting warnings, both get it wrong.

Also declares top-level `admissionRetries` beside `repairPasses` — pre-build
planner retries, which re-ask a recipe the compiler would not admit without
spending a repair pass. Optional, and absent on a run that needed none.

Nothing changes on the wire: the reader schemas were already `.passthrough()`,
so these fields were arriving and were simply invisible to a typed caller. The
new `review` sub-schema is deliberately tolerant — a delivered scene with a real
MP4 must never fail to parse over a malformed advisory.
