# Add Captions

> Generate and overlay captions on video.

## Overview

The Add Captions node automatically generates captions from video audio (or takes word-timed captions you supply) and overlays them on the video. Choose a static subtitle or one of five animated "kinetic" styles, with customizable position, font size, and color.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Style | Select | subtitle | Caption display style (see below) |
| Position | Select | bottom | Where captions appear |
| Font Size | Number | 32 | Text size in pixels (12-200) |
| Color | Color picker | #FFFFFF | Caption text color |

### Caption Styles

- **subtitle** — Standard subtitle appearance (rendered with FFmpeg)
- **word-highlight** — A window of words, the spoken one highlighted
- **karaoke** — Karaoke-style progressive fill, word by word
- **tiktok-words** — TikTok/CapCut-style 1–4 word "pages" that pop in
- **word-pop** — One word at a time, springing in and out
- **bouncy** — Full line visible, each word bounces as it's spoken

The five animated styles (everything except `subtitle`) are **kinetic** styles, rendered with Remotion.

### Kinetic style look (API / MCP)

When you drive Add Captions through the [API](../../api-integration.md) or an [MCP client](../../mcp/index.md) (e.g. Claude), the kinetic styles accept extra "look" levers to match a TikTok/Reels caption. They add **no credits**, and are **rejected on the static `subtitle` style** (which the FFmpeg path can't honour) rather than being silently ignored:

| Lever | Applies to | Description |
|-------|-----------|-------------|
| `font_family` | all kinetic | A font face (e.g. `Montserrat`, `Anton`, `Bebas Neue`, `Oswald`, `Poppins`; `Rubik`/`Heebo`/`Cairo`/`Tajawal` cover Hebrew & Arabic) |
| `stroke_color` + `stroke_width` | all kinetic | The black (or any colour) outline TikTok/Reels captions use; `stroke_width` in px |
| `highlight_color` | `tiktok-words` (also recolours the active word in `word-highlight` / `karaoke`) | Colour of the word being spoken |
| `uppercase` | all kinetic | Render captions in UPPERCASE |
| `position_y` | all kinetic | Vertical position of the caption's **center** as % of height; overrides `position`. ~65 sits below the face, above the app's own bottom UI |

> These levers are available today via the API and MCP; the canvas config panel exposes Style, Position, Font Size, and Color.

### Supplying your own captions (API / MCP)

Instead of `auto_transcribe`, you can pass a `captions[]` array. For the **kinetic** styles this is **word-timed: one entry per word** (a bare word is fine — words are auto-spaced, so `"face"`, `"doesn't"`, `"drift."` render as `face doesn't drift.`). Each entry:

| Field | Required | Meaning |
|-------|----------|---------|
| `text` | yes | The word (or, for `subtitle`, a line) |
| `startMs` / `endMs` | yes | The word's visibility window; also drives which word is highlighted |
| `timestampMs` | no (default null) | The word timestamp, used by `tiktok-words` token timing |
| `confidence` | no (default null) | Transcription confidence — metadata, ignored by rendering |

### Transcript input

Instead of transcribing in-place, you can **wire an upstream Transcript into the node's `transcript` input** (the JSON handle) — the word-timed output of a [Transcribe](../ai-text/transcribe.md) node, or the remapped transcript from an [Apply EDL](apply-edl.md) render. The node reshapes that transcript's words into the caption list and burns them in, so **captions stay aligned to a re-cut timeline**: an Apply EDL render remaps every word through the cut, and the captions follow (aligned to within ~80 ms across a crossfade boundary).

A wired transcript is a **timed** caption source, so it needs one of the **kinetic** styles — it is **rejected on the static `subtitle` style** (the FFmpeg path burns one fixed overlay and can't honour per-word timing), the same way the kinetic look levers are. A transcript that has no words is rejected up front, before any credits are reserved.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transcript` | JSON (handle) | — | An upstream Transcript (`{ version, words[], segments? }`). Object or JSON string. |
| `wordLevel` | Boolean | `true` | `true` = one caption **per word** (karaoke / word-highlight). `false` = words **grouped into lines** (a line closes on a speaker change, a sentence-ending word, a silence gap, or a maximum word count). |

> `wordLevel` only matters when a transcript is wired and a kinetic style is selected. Word-level is the default because the per-word kinetic styles highlight one word at a time; turn it off for calmer, line-at-a-time captions.

### Per-segment captions (API / MCP)

Apply **different caption treatments to different time ranges of the same video in one call** — e.g. a large uppercase phrase at the top for the intro, then one word at a time at the bottom for the body — by passing `segments[]`. When `segments` is present the whole render goes through the animated engine (so any `style`, including `subtitle`, and any look lever is valid on a segment).

Each segment:

| Field | Required | Meaning |
|-------|----------|---------|
| `start_ms` / `end_ms` | yes | The time range the segment covers. Segments must **not overlap**. |
| `style`, `position`, `font_size`, `color`, `background_color`, `font_family`, `stroke_color`, `stroke_width`, `highlight_color`, `uppercase`, `position_y` | no | Style/look overrides; each **inherits the top-level value** when omitted |
| `text` or `captions[]` | no | The segment's own words. If omitted, it uses the shared `captions[]`/`auto_transcribe` **filtered to its range**. `captions[]` timings are **absolute video-timeline ms** (not relative to the segment) — a word outside the segment's own range is not shown. |

Example — the intro/body split:

```json
{
  "video_url": "…",
  "segments": [
    { "start_ms": 0,    "end_ms": 3000,  "style": "subtitle", "position": "top",    "font_size": 96, "uppercase": true, "stroke_color": "#000000", "stroke_width": 8, "text": "Same face, every shot. No re-prompting." },
    { "start_ms": 3000, "end_ms": 20000, "style": "word-pop", "position": "bottom", "font_size": 48, "uppercase": true }
  ]
}
```

Per-segment captions render through the animated engine, so they bill at the kinetic rate.

### Position Options

- **bottom** — Lower third of the frame (most common)
- **top** — Upper portion of the frame
- **center** — Middle of the frame

## Inputs & Outputs

**Inputs:** Video with audio (required); an optional Transcript (JSON) on the `transcript` handle
**Outputs:** Video with burned-in captions
## Best Practices

- Use "subtitle" style for professional content
- Use "word-highlight" for social media content (increases engagement)
- Place captions at the bottom for landscape video, center for portrait/social
- Choose a font size appropriate for the output resolution (larger for 480p, standard for 1080p)

## Common Use Cases

- Add subtitles to talking head or narration videos
- Create engaging social media videos with word-by-word highlights
- Add accessibility captions to any video content
- Generate karaoke-style lyrics over music videos

## Tips

- Captions are auto-generated from the video's audio track — ensure audio is clear
- For more precise captions, use Transcribe first, edit the text, then use Forced Alignment
- White text with a dark video background is most readable; use colored text for light backgrounds
