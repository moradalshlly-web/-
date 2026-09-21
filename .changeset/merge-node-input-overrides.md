---
"@nodaro/shared": patch
---

New `mergeNodeInputOverrides(nodeType, data, overrides)`: the shallow merge of run-time input overrides over a node's saved data that every override lane should use. When the override swaps the node's primary media (its `INPUT_FIELD_MAP` field is a media url and the value changes) the saved `metadata` — facts measured from the old media, such as its length — is dropped unless the override supplies its own, so it can never describe a file that is no longer there. Additive; no existing export changes.

`editPlanSourceDurationSec` now honours an optional `metadata.mediaUrl` stamp: a `metadata.durationSeconds` stamped with the media it was measured from is returned only while that url is still the node's media (`extractedAudioUrl` or `url`); on a mismatch it returns `undefined`. Unstamped lengths behave exactly as before.
