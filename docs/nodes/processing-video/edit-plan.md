# Edit Plan

> Turn a timed transcript into an edit decision list (EDL) plan: tighten a recording, find short clips, or mark chapters.

**Cloud feature.** Edit Plan runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run.

## Overview

The Edit Plan node reads a **timed transcript** of a recording and produces an **edit decision list (EDL)** — a compact, JSON description of an edit that the [Apply EDL](./apply-edl.md) node renders into a finished cut. Edit Plan reads the transcript (and optional silence ranges), never the pixels, so it plans quickly and cheaply and hands the actual rendering to a downstream node.

It has three modes:

- **Tighten** — remove silence, filler words and false starts, and emit **one** EDL that is a cleaned-up version of the whole recording.
- **Clips** — find the strongest short, shareable moments and emit **one EDL per clip**. The node's output fans out, so each clip becomes its own downstream render (wire the output into an Apply EDL node and every clip renders in parallel).
- **Chapters** — mark chapter boundaries with titles and emit a `{ startMs, title }` list.

Because the plan is just data, an agent or you can decide *what* the edit is; the render happens downstream.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Transcript | json | **Yes** | The timed, word-level transcript. Wire it from a Transcribe node's `json` output. |
| Silence | json | No | Silence ranges from a Silence Detect node — helps the tighten pass cut dead air precisely. |
| Sources | video/audio | **Yes** | The media the edit draws from (1–6). Each connected source becomes an EDL source; annotate role / speakers / offset per source in the config panel. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| EDL | json | The edit plan. **Tighten** → one EDL object; **Clips** → a list of EDLs that fans out one downstream render per clip; **Chapters** → a `{ version, chapters }` object. Wire it into Apply EDL to render. |

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | tighten | `tighten` (clean up the whole recording), `clips` (find N short clips), or `chapters` (mark chapters). |
| Tier | Select | standard | Reasoning tier: `economy` (fastest, cheapest), `standard`, or `premium` (highest fidelity). Affects both quality and credit cost. |
| Instructions | Text | -- | Free-text steer for the plan (e.g. "keep the intro tight, drop the sponsor read"). |
| Style guide | Text | -- | Longer editorial guidance the plan should follow. |
| Clips: count | Number | -- | **Clips mode only.** How many clips to find (1–50). |
| Clips: target length (s) | Number | -- | **Clips mode only.** Target clip length in seconds (5–180). |
| Target aspect | Select | -- | Intended delivery aspect (`16:9`, `9:16`, `1:1`, `4:5`) — informs clip framing. |
| Platform | Text | -- | Intended platform hint (informs pacing and length). |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the instructions at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Credit Cost

> **Provisional pricing.** The numbers below are placeholders and will be finalized at launch. The Run button always shows the live estimate at the current rate.

Edit Plan is priced **per source-minute × tier**, plus a flat component for the extra per-clip work in Clips mode. The source duration is rounded up to a bucket (15 / 30 / 60 / 90 / 120 / 180 minutes) — the credit id carries that bucket.

- **Per source-minute (by tier):** economy `2`, standard `4`, premium `8` credits per minute.
- **Clips flat (by tier, added once in Clips mode only):** economy `10`, standard `20`, premium `40` credits.
- **Formula:** `credits = per_minute(tier) × bucket_minutes + (mode === "clips" ? clips_flat(tier) : 0)`

| Example | Bucket | Formula | Credits |
|---------|--------|---------|---------|
| Tighten · standard · 45-min episode | 60 min | `4 × 60` | 240 |
| Chapters · economy · 20-min episode | 30 min | `2 × 30` | 60 |
| Clips · premium · 90-min episode | 90 min | `8 × 90 + 40` | 760 |

The reserve is taken from the recording's own duration; on Nodaro Cloud the exact amount is settled against your account.

## Common Use Cases

- Tighten a long podcast or interview recording into a clean cut before rendering.
- Auto-find shareable short clips from an episode and render each one in parallel.
- Generate chapter markers with titles for a long-form upload.

## Tips

- Wire a **Transcribe** node's `json` output into **Transcript**, and (for tighten) a **Silence Detect** node into **Silence**, then wire Edit Plan's **EDL** output into an **Apply EDL** node to render the result.
- In **Clips** mode, one Edit Plan node feeds many renders: the output fans out, so a single Apply EDL downstream renders every clip.
- Use **economy** tier for a fast first pass; switch to **premium** for the final plan.
