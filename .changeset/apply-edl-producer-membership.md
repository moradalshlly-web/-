---
"@nodaro/shared": minor
---

`apply-edl` joins the producer/output classifiers: it is added to `DYNAMIC_PRODUCER_TYPES` (a node whose media output type is decided at runtime) and to the `VIDEO_OUTPUT_TYPES` set so `getOutputType` classifies its default handle as video (not the DYNAMIC→"data" fallback). Additive — existing members are unchanged; consumers that iterate these sets now see `apply-edl`.
