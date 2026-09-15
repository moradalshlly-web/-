---
"@nodaro/shared": minor
---

`pricedOutputDurationSec(provider, requested)` — the output seconds a video request is priced at when the caller omits `duration`: the provider's own default render length from `PRICING_DEFAULT_DURATION_SEC`, else 5. `seedance-2-5` and `grok-imagine-video-1.5` join that map at 8 s (their KIE default), so an omitted duration is priced under their `:8s:` tier instead of the 5 s one, and a Seedance reference-video reservation counts 8 output seconds.
