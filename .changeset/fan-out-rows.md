---
"@nodaro/shared": minor
---

Fan-out pairs by row. New `fan-out-rows` helpers, all additive — existing
members are unchanged — shared by the backend orchestrator and the in-browser
executor so the two cannot disagree on how a list fan-out is planned:

- `resolveListFanOut(candidates, nodeType)` — turns the list wires that reach a
  node into one fan-out (`ListFanOut`: the driving items, the row each came from,
  and the handle the driving list is wired to). The list holding the most values
  sets the rows; among lists with the same number of rows, the one that feeds the
  prompt drives, and a row runs when any of them has a value in it. Nothing
  depends on the order the wires were created in.
- `planFanOut(fanOut, nodeType, nodeData)` — expands a fan-out into its
  iterations (wraps `expandItemsWithRepeat`) and pins every iteration to the row
  it reads, so Repeat xN keeps each copy on its own row (`FanOutPlan`).
- `fanOutTextFeedsPrompt(nodeType, targetHandle)` / `NON_PROMPT_TEXT_LANES` —
  whether a text list wired to that handle of that node type is the node's
  prompt, or is routed to another text input (`negative`, `system-prompt`, …).
- `liveRowColumn(rows, colIndex)`, `compactWithRows(aligned)` — row-aligned
  column extraction: an empty cell stays in its row.
- `alignedFieldList(value, path)` — one entry per element of a root JSON array
  ("" where the element has no value), used by Extract Field's list output.
- `isFanOutUrlItem(item)` — the single "is this list item a media URL" guess.
- `EXECUTION_DATA_KEYS` gains `__alignedListResults` (the row-aligned twin of a
  node's list output — runtime state, never configuration).
