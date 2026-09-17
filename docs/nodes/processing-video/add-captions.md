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

### Position Options

- **bottom** — Lower third of the frame (most common)
- **top** — Upper portion of the frame
- **center** — Middle of the frame

## Inputs & Outputs

**Inputs:** Video with audio (required)
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
