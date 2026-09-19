# Add Captions

> Generate and overlay captions on video.

## Overview

The Add Captions node automatically generates captions from video audio (or takes word-timed captions you supply) and overlays them on the video. Choose a static subtitle or one of five animated "kinetic" styles, with customizable position, font size, and color. The kinetic styles take a **look** — a one-field preset that bundles font, outline, casing and spoken-word colour into the TikTok/Reels read — and the same styling levers (font, weight, outline, casing, vertical position, and `look` itself) now apply to `subtitle` too. The kinetic styles also carry an **`animate`** switch that can freeze their per-word motion.

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
- **word-highlight** — One line at a time, the spoken word highlighted (see [Line grouping](#line-grouping-word-highlight))
- **karaoke** — Karaoke-style progressive fill, word by word
- **tiktok-words** — TikTok/CapCut-style 1–4 word "pages" that pop in
- **word-pop** — One word at a time, springing in and out
- **bouncy** — Full line visible, each word bounces as it's spoken

The five animated styles (everything except `subtitle`) are **kinetic** styles, rendered with Remotion.

### Line grouping (word-highlight)

`word-highlight` shows **one line at a time**, not one word at a time. The words are grouped into lines at render:

- A line takes as many words as fit **~85 % of the frame width** at the chosen `font_size` and the look's font face (so a wide, heavy, uppercase face gets fewer words per line than a narrow one — see [font_size is measured against the look's face](#kinetic-style-look)).
- A line also **closes early** on a sentence-ending word (`.`, `!`, `?`, `…`) or on a pause of **0.5 s or more** between two words.
- When a phrase is too long for one line it is split into **balanced** lines rather than filled greedily, so its last word is never stranded alone (`OK SO I BUILT` / `A WORLD IN` / `NODARO STUDIO.`, not `… IN NODARO` / `STUDIO.`). Words are never moved across a sentence end or a pause.
- A line stays on screen for up to **1.5 s** after its last word, and the next line takes over the instant *it* starts — so the pauses *inside* a line and the ordinary pause *before* the next one are both bridged with no blank frame. A silence longer than 1.5 s (including at the end of the clip) clears the caption until the next line starts.
- Inside the visible line the **highlight moves word to word**: a word's `startMs`/`endMs` decide which word is lit, **not** whether text is on screen. During a pause, the last word spoken stays lit.

This is the CapCut read: the caption never blinks out between words, and a long sentence never overflows into a second wrapped line.

> This is the *render-side* grouping and it always applies to `word-highlight`. It is separate from `wordLevel: false` on a wired [transcript](#transcript-input), which groups words into lines in the **caption list itself** before rendering.

### Kinetic style look

The kinetic styles carry a **look** — a named preset that bundles the visual levers so a caption reads well from one field:

| `look` | What it renders |
|--------|-----------------|
| `outline` (default) | Heavy geometric sans (Montserrat 900), UPPERCASE, white text on a thick black outline, yellow spoken word — the TikTok/CapCut read |
| `clean` | Inter, no outline or casing |

The **spoken-word colour** (`highlight_color`, yellow under `outline`) only shows on the styles that mark one word at a time — `tiktok-words`, `karaoke`, `word-highlight`. `subtitle` (a whole phrase) and `word-pop` (a single word on screen) have no separate "spoken" word to recolour, so the look's outline/font/casing apply but the caption stays one colour.

**On the kinetic styles an unset `look` renders as `outline`** — that is the default kinetic look; pass `look: "clean"` to turn the preset off and keep only your own explicit levers. **`subtitle` has no default look:** a bare subtitle (no `look`, no styling levers) renders plain, and the outline house-style is opt-in — set `look`, or any styling lever, to bring it in.

**`font_size` is measured against the LOOK's face.** The same number renders wider or narrower depending on which face the look pins: the default `outline` look is **Montserrat 900 UPPERCASE**, roughly **30 % wider per character** than `clean` (Inter, mixed case). So the same `font_size` fits noticeably **fewer words per line** under `outline` — on `word-highlight`, where words are grouped to fit the frame, that shows up directly as shorter lines. Pass `look: "clean"` for the narrower face, pick a condensed face with `font_family` (`Bebas Neue`, `Anton`, `Oswald` are all narrower still), or lower `font_size`.

The explicit levers below **override individual fields of the chosen look** (they are added to it, not a replacement — e.g. with the default `outline`, setting only `highlight_color` keeps Montserrat / caps / outline and just recolours the spoken word). **Most of them — `font_family`, `font_weight`, `stroke_color`/`stroke_width`, `uppercase`, `position_y`, and `look` — now also apply to the static `subtitle` style.** Only `highlight_color` and `animate` stay **kinetic-only** and are rejected (`400`) on `subtitle` — a subtitle has no per-word spoken cursor to recolour and no motion to switch off. On the kinetic styles the levers add **no credits**; on `subtitle`, adding any styling lever switches the render from the cheap FFmpeg path to Remotion, so a styled `subtitle` **bills at the kinetic price** (`color` and `background_color` alone don't — FFmpeg honours those):

| Lever | Applies to | Description |
|-------|-----------|-------------|
| `font_family` | all styles | A font face (e.g. `Montserrat`, `Anton`, `Bebas Neue`, `Oswald`, `Poppins`; `Rubik`/`Heebo`/`Cairo`/`Tajawal` cover Hebrew & Arabic) |
| `font_weight` | all styles | CSS numeric weight 100–900 (in 100s). The chosen face must ship that weight or it renders at the nearest loaded one |
| `stroke_color` + `stroke_width` | all styles | The black (or any colour) outline TikTok/Reels captions use; `stroke_width` in px |
| `highlight_color` | **kinetic only** — `tiktok-words` (also recolours the active word in `word-highlight` / `karaoke`) | Colour of the word being spoken |
| `uppercase` | all styles | Render captions in UPPERCASE |
| `position_y` | all styles | Vertical position of the caption block's **center** as % of height; overrides `position` (see [Position Options](#position-options)). ~65 sits below the face, above the app's own bottom UI |
| `animate` | **kinetic only** | Per-word **motion** switch, default `true`. `false` freezes the motion while keeping grouping, line-holding and the highlight colour (see [The `animate` lever](#the-animate-lever-kinetic-styles)) |

**Outline width.** When the `outline` look supplies the stroke, its width auto-sizes to the text: `max(2, round(fontSize × 0.1))` px, painted half outside the glyph (`paint-order: stroke fill`) so the visible rim is ~5% of the font size. At `font_size: 64` that is a 6 px stroke; at `font_size: 32` it is a 3 px stroke. Set `stroke_width` explicitly to override it (`stroke_width: 0` = no outline).

#### The `animate` lever (kinetic styles)

`animate` (default `true`) is the per-word **motion** switch for the kinetic styles. Setting `animate: false` freezes the movement while keeping everything else — the line grouping, the line-holding, and the spoken-word highlight **colour** all stay; only the motion stops:

| Style | What `animate: false` freezes |
|-------|-------------------------------|
| `word-highlight` | the active word's size hop |
| `karaoke` | the progressive sweep |
| `tiktok-words` | the page's spring-in |
| `word-pop` | the single word's spring in and out |
| `bouncy` | each word's bounce as it's spoken |

The words still appear on cue and the active word is still recoloured — you get a still, styled caption whose text changes rather than animating. For a **fully static** line with no per-word colour change either, also set `highlight_color` to the same value as `color`. `animate` is **kinetic-only** — it is rejected (`400`) on `subtitle`, which has no motion to switch off.

> The canvas config panel exposes Style, Look, Position, Font Size, Color, and — for the kinetic styles — Font, Uppercase, spoken-word colour and outline colour. The full lever set (including `font_weight`, `position_y` and `animate`) is available via the API, MCP, and the [SDK](../../sdk-reference.md) (`client.media.addCaptions(...)`) — and over those surfaces the styling levers apply to `subtitle` too (the canvas surfaces them for the kinetic styles only).

### Supplying your own captions (API / MCP)

Instead of `auto_transcribe`, you can pass a `captions[]` array. For the **kinetic** styles this is **word-timed: one entry per word** (a bare word is fine — words are auto-spaced, so `"face"`, `"doesn't"`, `"drift."` render as `face doesn't drift.`). Each entry:

| Field | Required | Meaning |
|-------|----------|---------|
| `text` | yes | The word (or, for `subtitle`, a line) |
| `startMs` / `endMs` | yes | The word's **spoken** window. It always drives highlight / animation timing; what it means for **visibility** depends on the style (below) |
| `timestampMs` | no (default null) | The word timestamp, used by `tiktok-words` token timing |
| `confidence` | no (default null) | Transcription confidence — metadata, ignored by rendering |

**What `startMs`/`endMs` control, per style:**

| Style | On screen when | The word's window decides |
|-------|----------------|---------------------------|
| `subtitle`, `word-pop` | Exactly the entry's own `[startMs, endMs]` — nothing shows between entries | Visibility **and** timing |
| `word-highlight` | Its **line** is on screen, from the line's first `startMs` until the next line starts — or, if that is more than 1.5 s away, until 1.5 s past the line's last `endMs`. See [Line grouping](#line-grouping-word-highlight) | Which word is **highlighted**, and where lines break |
| `karaoke`, `bouncy` | The whole caption list is on screen, from the first `startMs` to the last `endMs` | Each word's wipe / bounce timing |
| `tiktok-words` | Its **page** (1–4 combined words) is on screen for that page's duration | Page boundaries and the spoken token |

### The auto-transcribe engine (`transcribe_provider`)

The node transcribes the video's audio itself unless something else already supplies the words: `captions[]`, a wired `transcript`, `auto_transcribe: false`, or — for a `segments[]` render — every segment carrying its own `text`/`captions`. **`text` does NOT suppress transcription**: it is the *fallback* source, used to build evenly-spaced synthetic captions whenever the transcription produces no words or does not run. `transcribe_provider` chooses the engine: `incredibly-fast-whisper` (the default), `elevenlabs-stt`, or `whisper`.

A **kinetic** style — and any `segments[]` render — is word-timed, so the engine must be one that returns **word timestamps**. `whisper` cannot (see [Transcribe](../ai-text/transcribe.md#word-timestamps-which-engine-can-do-it)). Pairing it with a word-timed render therefore behaves in one of two ways:

- **With another caption source available** — `text`, `captions[]`, a wired `transcript`, `auto_transcribe: false`, or self-sourced segments — the request is accepted and the transcription is **skipped**: nothing is sent to the engine (so nothing is transcribed or billed for it) and the render uses that other source. With only `text`, that means evenly-spaced synthetic captions off the text, exactly as this node behaved before word timings existed.
- **With no other caption source at all**, transcription is the render's only possible source and an engine that cannot feed it makes the call impossible: it is **rejected up front with `400 validation_error` on `transcribe_provider`**, before any credits are reserved.

`whisper` also stays valid for the static `subtitle` style, which never transcribes — it requires `text` and burns one fixed overlay.

### Transcript input

Instead of transcribing in-place, you can **wire an upstream Transcript into the node's `transcript` input** (the JSON handle) — the word-timed output of a [Transcribe](../ai-text/transcribe.md) node, or the remapped transcript from an [Apply EDL](apply-edl.md) render. The node reshapes that transcript's words into the caption list and burns them in, so **captions stay aligned to a re-cut timeline**: an Apply EDL render remaps every word through the cut, and the captions follow (aligned to within ~80 ms across a crossfade boundary).

A wired transcript is a **timed** caption source. It works with any style: on a **kinetic** style the words drive the per-word animation, and on `subtitle` a wired transcript now routes the render to Remotion and burns the words as **timed phrase lines** (so a timed `subtitle` bills at the kinetic price). A transcript that has no words is rejected up front, before any credits are reserved.

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
| `style`, `position`, `font_size`, `color`, `background_color`, `look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `highlight_color`, `uppercase`, `position_y`, `animate` | no | Style/look overrides; each **inherits the top-level value** when omitted (see the cascade note below) |
| `text` or `captions[]` | no | The segment's own words. If omitted, it uses the shared `captions[]`/`auto_transcribe` **filtered to its range**. `captions[]` timings are **absolute video-timeline ms** (not relative to the segment) — a word outside the segment's own range is not shown. A `subtitle` segment built from `text` or the shared transcript renders as **one phrase block** spanning its range (not one word at a time; use `\n` in `text` to force line breaks); a subtitle segment given its own `captions[]` renders those entries verbatim. |

**Look cascade (important).** `color`, `background_color`, `position`, and `position_y` are base fields — a segment inherits the top-level value for these when it doesn't set its own. One nuance: `position_y` overrides `position`, so a segment that sets its **own** `position` does **not** inherit the top-level `position_y` (an inherited value never beats a placement the segment asked for). The **look-specific** levers (`font_family`, `font_weight`, `stroke_color`/`stroke_width`, `highlight_color`, `uppercase`) behave differently: a segment **without** its own `look` inherits the top-level ones, but a segment that names its **own** `look` starts fresh from that preset and does **not** inherit the top-level look levers — so a top-level `highlight_color` will **not** carry onto a segment that sets `look`. Set that lever on the segment too if you want it there.

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

`position` anchors the caption **block**, and a named slot anchors the edge nearest the frame edge — so a block that wraps to more than one line grows *inward* and never clips off-screen. This is the authoritative mapping for the **Remotion render** — every kinetic style, any styled/timed `subtitle`, per-segment captions, and **any `position_y`**:

| Value | Where the block sits |
|-------|----------------------|
| `top` | The block's **top edge** at **12 %** of the frame height; extra lines grow **downward** |
| `bottom` (default) | The block's **bottom edge** **18 % above the bottom** — i.e. at **82 %** of the height, clear of the TikTok/Reels bottom UI; extra lines grow **upward** |
| `center` | The block is **centred** at **50 %** of the height |
| `position_y: N` | The block's **CENTRE** at **N %** of the height, overriding `position`. It is the centre, not an edge — `position_y: 85` puts the **centre** at 85 %, so the block's bottom hangs below that |

**Worked example.** On a 1920-tall frame, `position_y: 83.5` puts the block **centre** at ~1603 px (0.835 × 1920); a single line at the default `font_size` then has its bottom edge near ~1620 px — well below centre but still clear of the very bottom.

> **Plain-text `subtitle` fast-path exception.** A bare `subtitle` with only `text` (no styling lever and no `position_y`) renders through the cheaper FFmpeg `drawtext` burn, whose named slots use a **legacy** anchor: `bottom` sits ~40 px off the very bottom edge (≈ 98 %) and `top` ~40 px from the top. To get the mapping above (or any exact placement) on a subtitle, set `position_y` — that routes it through Remotion. Unifying the two anchors is a planned follow-up.

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
