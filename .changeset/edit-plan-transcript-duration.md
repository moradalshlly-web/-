---
"@nodaro/shared": minor
---

`edl.ts` gains `transcriptDurationSec(transcript)` — the latest `endMs` across a
transcript's words AND segments, in seconds (the max over both, mirroring the
plugin's own `transcriptDurationMs`). Additive; returns `undefined` for any
shape it can't measure. It is the edit-plan reserve's duration fallback beneath
the master-source ffprobe: a URL/reference-audio master exposes no length on its
node data, so an orchestrated reserve that cannot probe the media buckets the
credit hold on this transcript clock instead of the 180-minute ceiling.
