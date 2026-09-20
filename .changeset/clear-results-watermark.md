---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` gains `resultsClearedAt` — the time the editor's "Clear results" last emptied a node. It is runtime bookkeeping (kept out of presets, template exports and the copilot's view of a node like every other key in the set) and is NOT transient: it persists so the next load knows the node is empty on purpose and does not repaint the previous run onto it.
