---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Voice cloning is retired platform-wide. `@nodaro/shared` drops the `voice-clone` catalog entry and `ModelMode` member (`VoiceClone` stays — the list route still returns it). `@nodaro/sdk` keeps `voices.createClone()` / `voices.createCloneFromFile()` for source compatibility but marks them `@deprecated`: the routes now answer `410 voice_cloning_retired`. `@nodaro/cli` removes `voice clones create`; `voice clones list` / `delete` and `voice list --clones` keep working for clones made before the retirement.
