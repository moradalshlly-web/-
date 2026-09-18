# Add Captions

> Generate and overlay captions on video.

## Overview

The Add Captions node automatically generates captions from video audio (or takes word-timed captions you supply) and overlays them on the video. Choose a static subtitle or one of five animated "kinetic" styles, with customizable position, font size, and color. The kinetic styles also take a **look** — a one-field preset that bundles font, outline, casing and spoken-word colour into the TikTok/Reels read.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Style | Select | subtitle | Caption display style (see below) |
| Look | Select | outline | Kinetic styles only. `outline` or `clean` (see [Kinetic style look](#kinetic-style-look)) |
| Position | Select | bottom | Where captions appear |
| Font Size | Number | 32 | Text size in pixels (12-200) |
| Color | Color picker | #FFFFFF | Caption text color |
| Font / Uppercase / Spoken-word colour / Outline colour | — | from look | Kinetic styles only. Override individual parts of the look |

### Caption Styles

- **subtitle** — Standard subtitle appearance (rendered with FFmpeg)
- **word-highlight** — A window of words, the spoken one highlighted
- **karaoke** — Karaoke-style progressive fill, word by word
- **tiktok-words** — TikTok/CapCut-style 1–4 word "pages" that pop in
- **word-pop** — One word at a time, springing in and out
- **bouncy** — Full line visible, each word bounces as it's spoken

The five animated styles (everything except `subtitle`) are **kinetic** styles, rendered with Remotion.

### Kinetic style look

The kinetic styles carry a **look** — a named preset that bundles the visual levers so a caption reads well from one field:

| `look` | What it renders |
|--------|-----------------|
| `outline` (default) | Heavy geometric sans (Montserrat 900), UPPERCASE, white text on a thick black outline, yellow spoken word — the TikTok/CapCut read |
| `clean` | Inter, no outline or casing |

The **spoken-word colour** (`highlight_color`, yellow under `outline`) only shows on the styles that mark one word at a time — `tiktok-words`, `karaoke`, `word-highlight`. `subtitle` (a whole phrase) and `word-pop` (a single word on screen) have no separate "spoken" word to recolour, so the look's outline/font/casing apply but the caption stays one colour.

**An unset `look` renders as `outline`** — that is the default kinetic look. Pass `look: "clean"` to turn the preset off and keep only your own explicit levers.

The explicit levers below **override individual fields of the chosen look** (they are added to it, not a replacement — e.g. with the default `outline`, setting only `highlight_color` keeps Montserrat / caps / outline and just recolours the spoken word). They add **no credits**, and are **rejected on the static `subtitle` style** (which the FFmpeg path can't honour) rather than being silently ignored:

| Lever | Applies to | Description |
|-------|-----------|-------------|
| `font_family` | all kinetic | A font face (e.g. `Montserrat`, `Anton`, `Bebas Neue`, `Oswald`, `Poppins`; `Rubik`/`Heebo`/`Cairo`/`Tajawal` cover Hebrew & Arabic) |
| `font_weight` | all kinetic | CSS numeric weight 100–900 (in 100s). The chosen face must ship that weight or it renders at the nearest loaded one |
| `stroke_color` + `stroke_width` | all kinetic | The black (or any colour) outline TikTok/Reels captions use; `stroke_width` in px |
| `highlight_color` | `tiktok-words` (also recolours the active word in `word-highlight` / `karaoke`) | Colour of the word being spoken |
| `uppercase` | all kinetic | Render captions in UPPERCASE |
| `position_y` | all kinetic | Vertical position of the caption's **center** as % of height; overrides `position`. ~65 sits below the face, above the app's own bottom UI |

**Outline width.** When the `outline` look supplies the stroke, its width auto-sizes to the text: `max(2, round(fontSize × 0.1))` px, painted half outside the glyph (`paint-order: stroke fill`) so the visible rim is ~5% of the font size. At `font_size: 64` that is a 6 px stroke; at `font_size: 32` it is a 3 px stroke. Set `stroke_width` explicitly to override it (`stroke_width: 0` = no outline).

> The canvas config panel exposes Style, Look, Position, Font Size, Color, and — for the kinetic styles — Font, Uppercase, spoken-word colour and outline colour. The full lever set (including `font_weight` and `position_y`) is available via the API, MCP, and the [SDK](../../sdk-reference.md) (`client.media.addCaptions(...)`).

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
| `style`, `position`, `font_size`, `color`, `background_color`, `look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `highlight_color`, `uppercase`, `position_y` | no | Style/look overrides; each **inherits the top-level value** when omitted (see the cascade note below) |
| `text` or `captions[]` | no | The segment's own words. If omitted, it uses the shared `captions[]`/`auto_transcribe` **filtered to its range**. `captions[]` timings are **absolute video-timeline ms** (not relative to the segment) — a word outside the segment's own range is not shown. A `subtitle` segment built from `text` or the shared transcript renders as **one phrase block** spanning its range (not one word at a time; use `\n` in `text` to force line breaks); a subtitle segment given its own `captions[]` renders those entries verbatim. |

**Look cascade (important).** `color`, `background_color`, `position`, and `position_y` are base fields — a segment always inherits the top-level value for these when it doesn't set its own. The **look-specific** levers (`font_family`, `font_weight`, `stroke_color`/`stroke_width`, `highlight_color`, `uppercase`) behave differently: a segment **without** its own `look` inherits the top-level ones, but a segment that names its **own** `look` starts fresh from that preset and does **not** inherit the top-level look levers — so a top-level `highlight_color` will **not** carry onto a segment that sets `look`. Set that lever on the segment too if you want it there.

Example — the intro/body split (a large outlined phrase at the top, then one word at a time at the bottom). Both segments get the `outline` look; the intro renders as one phrase block because its style is `subtitle`:

```json
{
  "video_url": "…",
  "look": "outline",
  "segments": [
    { "start_ms": 0,    "end_ms": 3000,  "style": "subtitle", "position": "top",    "font_size": 96, "text": "Same face, every shot. No re-prompting." },
    { "start_ms": 3000, "end_ms": 20000, "style": "word-pop", "position": "bottom", "font_size": 48 }
  ]
}
```

Because a segment without its own `look` inherits the top-level one, setting `look: "outline"` once at the top applies Montserrat 900, caps and the black outline to **both** segments. (The yellow spoken-word colour doesn't show here — neither `subtitle` nor `word-pop` marks a single word; it would appear on `tiktok-words` / `karaoke` / `word-highlight`.)

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
