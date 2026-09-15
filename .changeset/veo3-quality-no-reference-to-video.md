---
"@nodaro/shared": patch
"@nodaro/prompts": patch
---

VEO 3.1 Quality no longer claims reference-to-video support.

`MODEL_CATALOG["veo3"]` declared `features: [… "reference-image"]`, and
`VIDEO_REF_LIMITS_BY_PROVIDER["veo3"]` gave it a 3-image cap. KIE serves
reference-to-video on the Fast and Lite SKUs only, and says so in its own
words on a rejected production job: *"Reference to video only supports the Veo
Fast model and Veo Lite model."* So every reference-carrying Quality run
advertised a capability, sent `generationType: "REFERENCE_2_VIDEO"`, and came
back 422 — after the credits were reserved.

- **`@nodaro/shared`**: `veo3` drops the `reference-image` feature and its
  `VIDEO_REF_LIMITS_BY_PROVIDER` row (the drift guard binds the two 1:1, and
  the catalog is the single authority on *which* models carry references).
  Everything derived from that flag follows on its own: `modelsWithFeature`,
  the `{image:N}` token gate, the server-side `connectedReferences` assembly,
  and `GVP_SUPPORTED_PROVIDERS` — so VEO 3.1 Quality also leaves the Generate
  Video Pro model list, whose stated bar is "takes a start still **and** can
  carry reference images". `veo3.1` (Fast) and `veo3_lite` (Lite) are
  unchanged and keep the 3-image cap.
- **`@nodaro/prompts`**: the VEO prompt doctrine's "Frames & references"
  section now says reference ingredients are a Fast/Lite capability.

Nothing else moves: Quality keeps every mode it actually has (t2v, i2v,
first+last frame, native audio) at the same price.
