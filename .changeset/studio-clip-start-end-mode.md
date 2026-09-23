---
"@nodaro/sdk": minor
---

Studio clip generation: `mode` accepts `"start-end"`.

`StudioShotGenerationInput.mode` and `StudioGenerateRequest.mode` are now `"start" | "start-end" | "references"`. `start` sends only the start frame (a pinned end frame is not sent); `start-end` sends the start and the end frame; omit `mode` to let the scene's saved inputs decide. Requires a platform whose studio route accepts `start-end` — an older one refuses the value.
