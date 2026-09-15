---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D: an unreviewed delivery now says WHY there is no verdict, instead of
always blaming the provider.

`metadata.review = { verdict: "unavailable", reason, attempts, ... }` has a
second `reason`. `"provider"` still means the review never reached its
provider. `"unusable"` is new: the provider answered, but every asking came back
with nothing usable — an answer that failed the review contract, one that cited
a frame it was never shown, or a refusal that was not a transport fault. The
engine asks such a review once more and then delivers the assertion-passing
scene unreviewed. `verdict` is unchanged, and so is every other field.

`pro3DRenderReviewVerdictSchema` used to rewrite `"unusable"` to `"provider"`
on the way in, and `scene3DReviewVerdictOf` hard-coded `"provider"`, so
`scene3DReviewNote` told the caller the review "did not reach its provider"
about a provider that had answered. Both readers now keep `"unusable"`, and the
note says "the visual review returned no usable verdict in N attempts; it was
delivered unreviewed" — the same words the leading `SCENE_REVIEW_UNAVAILABLE`
warning carries. A reason neither reader knows still falls back to
`"provider"` rather than dropping the verdict.

**New exports.** `SCENE3D_REVIEW_UNAVAILABLE_REASONS` (the one list every reader
uses), the `Scene3DReviewUnavailableReason` type, and the
`isScene3DReviewUnavailableReason` guard. `Scene3DReviewUnavailable["reason"]`
widens from `"provider"` to `"provider" | "unusable"`. A `switch` on it that
handled only `"provider"` still compiles, but it should add the new case.
