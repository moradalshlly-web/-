# Apply EDL

> Render an edit decision list (EDL) into one finished media file — plus, optionally, a transcript remapped to match the cut.

## Overview

The Apply EDL node takes a structured **edit decision list** and renders it into a single video or audio file with one FFmpeg pass. An EDL is a compact, JSON description of an edit: a list of `sources` (the media it draws from) and an ordered list of `segments` (which slice of which source plays, and in what order). Because the EDL is data, an editorial node (or an agent, or you by hand) can decide *what* the edit is, and Apply EDL turns that decision into pixels and sound.

Every segment names a time window on the **master clock**; the node trims each source to that window, conforms the picture to one canvas, and joins the segments in order. Hard-cut boundaries abut; crossfade boundaries overlap, so the rendered timeline is *shorter* than the sum of the segment lengths by the total crossfade time.

When you wire a **Transcript** into the node, it emits that transcript **remapped through the cut** on its `json` output — words that fall in removed material are dropped and a word straddling a cut is clipped to the kept part — so captions built downstream stay aligned to the finished edit.

All processing is local FFmpeg. No provider key is required.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | **Yes** | The edit decision list. Wire it from an editorial node or a Text/JSON source. Media resolves from each source's `url`. |
| Transcript | json | No | A transcript to remap through the cut for the `json` output (e.g. from a Transcribe node). |
| Sources | video/audio | No | Optional media-URL overrides for the EDL's sources, applied **positionally** in connection order. The EDL's own `url` values are the primary path; use this only when the media isn't addressable by URL in the EDL. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Media | video **or** audio | The rendered cut. Its type follows the **Output** setting. |
| Transcript | json | The wired transcript remapped through the cut. Empty when no transcript is wired. |

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Output | Select | video | Render `video` (picture + sound) or `audio` (sound only). |
| Quality | Select | final | `final` = full-quality delivery; `proxy` = a fast 720p review render. |
| Default crossfade (ms) | Number | 0 | Crossfade applied at every boundary that has **no** explicit transition in the EDL. Clamped per-boundary to 90% of the shorter neighbouring segment (the FFmpeg limit), so it can never over-blend a short segment. `0` = hard cuts. |

## How the edit is rendered

- **Segment order is the timeline.** The node never re-sorts segments — a multicam or clip-reordering EDL legitimately revisits earlier source time.
- **Boundaries.** A `cut` boundary abuts the two segments; a `crossfade` boundary overlaps them (an FFmpeg `xfade` for video, `acrossfade` for audio), which *compresses* the timeline by the crossfade length.
- **Master audio.** If one source is marked as the master audio, every segment's sound comes from it — a camera switch never touches the sound. Otherwise each segment uses its own audio.
- **Validation up front.** The EDL is normalized and validated before any render starts, so a missing or unresolvable source, or a video edit with a picture-less segment, is reported immediately (with the offending id named) rather than failing mid-render.

## Credit Cost

Priced **per minute of rendered output**, measured on the finished (crossfade-compressed) length:

- **Formula:** `10 credits × ceil(output_seconds ÷ 60)`
- **Floor:** minimum 1 minute (10 credits)

| Rendered output length | Minutes billed | Credits |
|------------------------|----------------|---------|
| 40 seconds | 1 | 10 |
| 3 min 10 s | 4 | 40 |
| 12 min 00 s | 12 | 120 |

The **reserve** is computed from the EDL's own durations (crossfades already subtracted), so what you are charged matches the render.

### What the estimate shows before you run

The cost on the node, the **Run** button and the run-confirm dialog is an **estimate** at the current rate — what a render realistically costs, leaning high. It is not a guarantee: the true length of a cut is decided by the plan, and when that plan is about to be regenerated the editor cannot know it yet.

**When the cut already exists, the estimate is exact:**

- **An EDL set on the node itself** (nothing wired into **EDL**) is exactly what renders.
- **Running only this node** — the **Run** button, or the cost shown on the node — renders the plan already on the canvas, so it is priced at that plan's own length.

**When an upstream Edit Plan re-plans in the same run** (running the whole workflow), the plan on the canvas is the *previous* run's and is ignored — last week's shorter episode must not under-price this week's:

- **Tighten** is priced at the **episode's full length** (the longer of the master source and the transcribed media). A tightened cut is normally shorter, so this over-quotes. With no recorded length it prices the 180-minute ceiling — see [Edit Plan](./edit-plan.md#what-the-estimate-shows-before-you-run).
- **Clips** is priced **per clip at twice the clip-length setting** (the setting is a target the planner aims near, not a limit; with no setting, 90 seconds is assumed), never more than the episode, multiplied by the **clip count** (8 when unset, at most 50). Every node fed from the render with an *each* edge — such as Add Captions — is counted per clip too. A planner that returns much longer clips than the target can cost more than the estimate.
- **An EDL from any other node that re-runs** prices the 180-minute ceiling.

The balance check before a run compares against this estimate. You are **charged for the length of the cut that is rendered** — computed from its EDL — never for the estimate.

## Common Use Cases

- Render a transcript-driven "tighten" of a long recording into a clean cut.
- Assemble a set of clip ranges into one deliverable from a single edit description.
- Produce an audio-only cut of an edit (podcast episode) with the same timeline as its video version.
- Emit an aligned transcript alongside the cut to feed a captions node.

## Tips

- Leave **Default crossfade** at 0 for talking-head/podcast edits — hard cuts on speech read cleanly, and the EDL can still ask for a crossfade on any individual boundary.
- Use **Proxy** quality for review passes, then switch to **Final** for delivery.
- Wire a Transcribe node's transcript into the **Transcript** input so the `json` output carries the transcript **remapped onto the finished edit** — every word timestamp shifts to match the cut. Downstream nodes read that aligned transcript — wire it into [Add Captions](add-captions.md#transcript-input)' `transcript` input and the captions follow the cut. Captions need the transcript's **words**, so run that Transcribe node on `elevenlabs-stt` or `incredibly-fast-whisper`: a `whisper` transcript (phrase segments, no words) that reaches Add Captions through this node is [refused before the run](../ai-text/transcribe.md#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run), with nothing billed.
