---
"@nodaro/shared": minor
---

`edit-plan` (podcast editing) support in the shared contract: a new
`unwrapEditPlanOutput(outputData)` helper + `ChapterSet` type in `edl.ts`
normalize an edit-plan job's `output_data` into the value stored on the node's
`data.generatedJson` (clips → bare `Edl[]`, chapters → `{version, chapters}`,
tighten → the `Edl`), and `edit-plan` joins `FAN_OUT_EACH_TYPES` so a `clips`
edge fans out one downstream execution per clip. Additive — existing members are
unchanged.
