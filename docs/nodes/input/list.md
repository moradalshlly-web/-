# List

> Define a list of items — or a multi-column typed table — for batch iteration.

## Overview

The List node is a fan-out source: every downstream node connected to it runs **once per row** in the list. It is a data node — it makes no API call, produces no job, and costs **0 credits**.

By default it is a simple single-column list of text items ("Items") — paste or add one value per row, and each value is emitted to downstream nodes in turn. When you need more than one variable per iteration, the same node **grows into a multi-column typed table**: connect a producer to the node's bottom-left **"+"** handle and a new column is added. Each column is typed and gets its own input handle (to receive values from upstream) and output handle (to feed a downstream node).

The config panel adapts to the column count: it shows the single-column **List** editor at one column and the multi-column **Table** editor once you have more than one. The node's view mode (list / gallery / packed) is chosen automatically from the column types.

On the canvas the node has two display states, toggled by the small table/info button in the strip under the node: a compact **info** summary ("N rows × M cols") and the full **data** view (the gallery/table itself). A table with a media column (image / video / audio) that has content — typed in, uploaded, or resolved live from a connected source — opens in the data view automatically; empty tables and pure-text tables start compact. The toggle is display-only and never executes anything; an explicit toggle always wins over the default.

> The legacy `loop` node (UI label "Table") was merged into this node. `loop` is now a deprecated alias that auto-migrates to `list` on load — existing workflows keep working.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Items / Columns | Dynamic table | One text column ("Items") | Rows of values. Starts as a single text column; add columns by connecting producers to the bottom-left "+" handle |
| Column type | text / image-url / video-url / audio-url / json | text | Per-column data type. Determines the column's handle type and the node's auto-selected view mode |

Each row is one iteration. The item/row counter shows the total number of entries.

## Inputs & Outputs

**Inputs:**
- Bottom-left **"+"** handle — connect a producer to add a new typed column
- Per-column input handles (`col_<id>_in`) — receive values into a specific column from upstream

**Outputs:**
- Single-column mode: each item is emitted in turn to downstream nodes
- Multi-column mode: per-column outputs (`col_<id>`) — each column's value is available as a separate output per iteration

## How rows pair up

When two or more columns feed the **same** downstream node (for example a `prompt` column into a Generate Image node's `prompt` input and a `negative` column into its `negative` input), the node runs once per **row** and every input gets the value from **that row**:

- **Row 3 always stays row 3.** An empty cell is simply empty for its row — that input gets nothing for that run. It does not pull the rows below it up.
- **A row runs when any of its cells has a value.** A row that is empty in every column is ignored (so the blank row at the bottom of the table never adds a run).
- **The order you connected the wires in does not matter.** The column wired to the node's prompt input is the one that supplies the prompt, whichever wire you drew first. A column wired to `negative` (or another side input such as `system-prompt`) is never used as the prompt.
- **Repeat ×N repeats the row.** With Repeat set to 2 on the downstream node, each row runs twice with that same row's values.
- The table on the canvas shows the rows exactly as they will run, including the empty cells.

A per-row prompt **replaces** the prompt typed on the downstream node (it is not appended to it) — also when another list, such as a column of images, feeds the same node. For a row whose prompt cell is empty, the typed prompt is used.

Lists with a **different number of rows** are not paired row-to-row: the one holding more values sets the number of runs, and the shorter one starts over from its first row when it runs out. This does not depend on which wire was connected first either. The same goes for two columns of one table when only one of the wires has a range or item filter on it — the filter changes that wire's row count.

Only a wire in **Each** mode runs the node once per row. A wire set to **Bundle** hands the whole list over in a single run.

## Best Practices

- Keep single-column list items consistent in format for predictable downstream behavior
- Use one concept per item — each item should be a complete, standalone prompt or value
- Add a column (via the "+" handle) only when you genuinely need a second variable per iteration — typed columns map cleanly to different input fields on downstream nodes
- Set each column's type to match its content (image-url, video-url, etc.) so the view mode and downstream wiring resolve correctly

## Common Use Cases

- Batch-generate images from a list of prompts (single column)
- Process multiple subjects through the same video generation pipeline
- Generate TTS audio for multiple text entries
- Generate character images with different names and descriptions per row (multi-column)
- Drive videos with varying prompts and reference-media URLs per row (multi-column)

## Tips

- Press Enter to add a new row quickly
- Rows are processed in order from top to bottom
- Each row triggers a separate downstream execution — more rows means longer total runtime
- For very large batches, consider breaking into smaller lists to manage workflow size
- To close a fan-out (pick the best variant, count survivors, or merge results), feed the downstream output into a [Reduce](../utility/reduce.md) node
