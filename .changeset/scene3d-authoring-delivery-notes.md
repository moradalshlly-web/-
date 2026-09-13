---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D authoring results now DECLARE the three fields an advanced engine
already delivers, so an SDK caller can read them without casting.

- `validation.warnings[]` entries coded `SCENE_AUTHORING_ASSUMPTION` — the
  planner's assumptions, carrying any normalization the engine applied. The new
  `SCENE3D_AUTHORING_ASSUMPTION_CODE` export is the one place that string is
  written down.
- `metadata.summary` — the planner's one-or-two-sentence description of what it
  authored; on a repaired run, of the repair.
- top-level `repairPasses` — repairs actually RUN, never the authoring-pass
  count, so a scene accepted first time reports `0`.

All three are optional on `Pro3DRenderJobOutput` (and its reader schema) and on
`Scene3DJobOutputAny` / `Scene3DJobOutputV2` via the new
`Scene3DAuthoringDelivery` mixin. Nothing changes on the wire: the schemas were
already `.passthrough()` and the fields were already arriving — they were simply
invisible to a typed caller. A render-only export authored nothing and still
reports no summary and omits `repairPasses` rather than claiming `0`; the
deterministic Basic lane carries none of the three.
