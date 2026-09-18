---
"@nodaro/shared": minor
---

Auto video duration. `VIDEO_DURATION_AUTO` (`-1`), `isAutoVideoDuration`, `supportsAutoVideoDuration` and `maxVideoDurationSec` are new exports, and `MODEL_CATALOG` entries gain an optional `autoDuration` capability (declared on the Seedance 2 family) — the model picks the clip length. `pricedOutputDurationSec` prices Auto at the model's longest clip, so `buildVideoCreditModelIdentifier(provider, -1, …)` returns the top duration tier instead of the cheapest one; `normalizeModelInput` / `validateModelInput` accept `-1` for a model that declares the capability. Additive — every existing duration behaves as before.
