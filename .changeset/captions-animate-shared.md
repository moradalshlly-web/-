---
"@nodaro/shared": minor
---

Captions: add `captionRoutesToRemotion()` and `resolveCaptionLevers()` (bare-subtitle-stays-plain rule, single-sourced across the render/segment/panel sites); narrow `KINETIC_ONLY_CAPTION_LEVER_KEYS` to `[highlightColor, animate]` so `subtitle` accepts the styling levers.

A `null` lever is unset: `captionRoutesToRemotion()` treats a `null` styling
lever exactly like an omitted one (stored node JSON carries nulls, and a null
must not buy the Remotion renderer or its price), and
`normalizeCaptionNumericLevers()` drops a null numeric lever instead of carrying
it into the render plan.
