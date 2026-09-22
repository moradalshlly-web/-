---
"@nodaro/shared": minor
---

New `EDIT_PLAN_DEFAULT_CLIP_COUNT` (8), `EDIT_PLAN_MAX_CLIP_COUNT` (50) and `clampEditPlanClipCount(count)`: one source for how many clips an Edit Plan `clips` run returns by default and the most it may be asked for. `clampEditPlanClipCount` floors and clamps a positive number into `[1, 50]` and returns `undefined` for anything else, so a caller can pass a raw setting straight through. Additive — no existing export changes.
