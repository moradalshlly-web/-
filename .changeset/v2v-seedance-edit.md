---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Seedance video EDIT contract for the Video to Video node. Seedance has no video-to-video endpoint — it edits a video handed to it as a *reference* when the prompt reads as an edit instruction — so every surface dispatches that lane as a text-to-video request in edit shape, with the source clip as reference video 1.

`@nodaro/shared` adds:

- `SEEDANCE_VIDEO_EDIT_PROVIDERS` + `isSeedanceVideoEditProvider(provider)` — the models that behave this way (`seedance-2-5` today), and the type `SeedanceVideoEditProvider`.
- `VIDEO_TO_VIDEO_NODE_PROVIDERS` + `VideoToVideoNodeProvider` — every model the Video to Video NODE offers, i.e. `VIDEO_TO_VIDEO_PROVIDERS` plus the edit providers. `VIDEO_TO_VIDEO_PROVIDERS` (the `/v1/video-to-video` route enum) is deliberately UNCHANGED: that endpoint cannot serve these models, so a client must keep validating route requests against it.
- `SEEDANCE_VIDEO_EDIT_SHAPE` — the `{ aspectRatio: "adaptive", duration: -1 }` pair the edit request sends up front, so the output keeps the source clip's own ratio and length.
- `seedanceVideoEditCreditId(provider, resolution?)` — the credit identifier that lane reserves under (the reference-video ladder at the model's longest clip, settled down to the delivered length). One builder, so a quote can never disagree with the reservation.

`@nodaro/prompts` adds:

- `SEEDANCE_VIDEO_EDIT_PREFIX` — the `edit {video:1} as follows:\n` instruction, written with the editor reference token so it resolves through the normal reference resolver.
- `buildSeedanceVideoEditPrompt(prompt)` — frames a prompt as an edit of the source clip. Idempotent: a prompt that already opens with the instruction (either token spelling) is returned unchanged.

All additive — no existing export changes shape or behaviour.
