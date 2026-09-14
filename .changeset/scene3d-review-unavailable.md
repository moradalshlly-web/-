---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D: a visual review its provider could not perform is now a typed verdict,
and no longer blanks the delivered video.

An advanced authoring run whose review never reaches its provider asks once more
after a bounded pause and, if it is still unreachable, delivers the
assertion-passing scene unreviewed rather than throwing it away. That result
carries `metadata.review = { verdict: "unavailable", reason: "provider",
attempts, objections[], observed? }`, and `validation.warnings[]` leads with the
new `SCENE_REVIEW_UNAVAILABLE` code.

**The reader fix.** `Scene3DReviewVerdict` was declared with `verdict: "refused"`
as a literal, and `pro3DRenderReviewVerdictSchema` matched it. So the new shape
did not merely read as "no review": `isPro3DRenderJobOutput` returned `false`
for the WHOLE result, blanking a real, paid, playable MP4 over an advisory
field. The verdict is now a discriminated union — a consumer switching on
`verdict` needs one new arm and no re-typing of the arm it has — and the
schema's `review` degrades to absent rather than refusing the result, so a
verdict a future engine invents costs at most itself.

**New exports.** `SCENE3D_REVIEW_UNAVAILABLE_CODE`, the `Scene3DReviewFindings`
/ `Scene3DReviewRefused` / `Scene3DReviewUnavailable` arms, and
`scene3DReviewNote(verdict)` — one user-safe sentence for either verdict, so a
surface cannot report "the reviewer refused this scene" about one nobody saw.
`scene3DReviewVerdictOf` reads both arms and clamps a nonsense `attempts` rather
than discarding an otherwise good verdict.

`objections` may be non-empty on the `unavailable` arm: a review is batched, and
whichever batches answered before the outage are real evidence that is **not** a
verdict on the scene. An empty list there is silence, not approval.

Additive and optional throughout — a client that ignores the new verdict behaves
as it did, except that it no longer loses the result it was already being given.
