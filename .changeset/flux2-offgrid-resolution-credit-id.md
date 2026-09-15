---
"@nodaro/shared": patch
---

`buildCreditModelIdentifier` no longer emits an off-grid Flux 2 identifier. Flux 2 is the only family whose credit id interpolates `resolution` rather than matching it, and callers legitimately pass another model's value space — the multi-provider cost preview prices one node's data against every selected provider, and node data written straight into workflow JSON never ran the editor's provider-change fail-safe. A resolution such as `"2K"` used to build `flux-2-pro:2KMP:0ref`, which no pricing row carries. Any value off the megapixel grid now snaps to the model's default tier (the same `preferred` value `normalizeModelInput` uses, so the preview asks for exactly the id the route reserves), and an on-grid value is emitted in the grid's own spelling (`"2.0 MP"` → `:2MP:`). An absent resolution is unchanged.
