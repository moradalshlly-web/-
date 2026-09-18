---
"@nodaro/shared": minor
---

`edit-plan` (podcast editing) support in the shared contract. All additive —
existing members are unchanged.

`edl.ts` gains:
- `unwrapEditPlanOutput(outputData)` — normalizes an edit-plan job's `output_data`
  into the value stored on the node's `data.generatedJson` (clips → bare `Edl[]`,
  chapters → `{version, chapters}`, tighten → the `Edl`).
- `ChapterSet` type (the `chapters` mode output shape).
- The credit-id STRUCTURE (values live app-side): `EDIT_PLAN_MODES`,
  `EDIT_PLAN_TIERS`, `EDIT_PLAN_BUCKET_MINUTES`, `EDIT_PLAN_MAX_MINUTES`,
  `EDIT_PLAN_BASE_CREDIT_ID`, `editPlanBucketMinutes`, `buildEditPlanCreditId`,
  `asEditPlanMode`, `asEditPlanTier`, and the `EditPlanMode` / `EditPlanTier`
  types — the same structural credit-id vocabulary as `buildVideoAnalysisCreditId`
  (no pricing values; those stay in the app + migration).

`producer-types.ts`: `edit-plan` joins `FAN_OUT_EACH_TYPES` so a `clips` edge
fans out one downstream execution per clip.
