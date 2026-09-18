---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Captions: named "look" presets + a typed SDK `media.addCaptions()`.

`@nodaro/shared` gains `CAPTION_LOOK_IDS`, `CAPTION_LOOKS`, `DEFAULT_CAPTION_LOOK`, `KINETIC_ONLY_CAPTION_LEVER_KEYS`, `autoStrokeWidth`, `resolveCaptionLook`, and the types `CaptionLookId`, `CaptionLookLevers`, `KineticOnlyCaptionLeverKey`. A look is a bundle of visual levers (font, weight, colour, outline, spoken-word colour, casing) so a kinetic caption reads well from one field: `outline` (Montserrat 900, uppercase, white on a black outline sized `max(2, round(fontSize·0.1))`px, yellow spoken word — the TikTok/CapCut read) and `clean` (Inter, soft shadow, no casing/outline). `resolveCaptionLook(look, explicit, fontSize)` merges an explicit lever over the look; an UNSET look resolves to `outline`. Structural/config vocabulary only — no creative doctrine.

`@nodaro/sdk`: new `client.media.addCaptions(input)` — burns captions into a video via `POST /v1/add-captions`, with the `look` preset, the explicit look levers, and per-segment captions. New exported types `AddCaptionsInput`, `CaptionLookInput`, `CaptionSegmentInput`, `CaptionEntry`.
