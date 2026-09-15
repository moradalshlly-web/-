# Upload Audio

> Upload or provide a URL to an audio file.

## Overview

The Upload Audio node provides a source audio file to the workflow. Enter a direct URL or upload an audio file for use with TTS, lip sync, dubbing, voice processing, or audio mixing nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | Direct URL to an audio file |

Accepts: MP3, WAV, M4A, AAC, FLAC, OGG formats.

## Adjust Audio

Choosing a file (or dropping one on the node) opens an **Adjust Audio** step before the upload is committed:

| Control | What it does |
|---------|--------------|
| Trim | Waveform scrubber with draggable start/end handles and looped preview playback. Only the selected range is passed downstream. |
| Output Format (under **Advanced**) | Convert to MP3, WAV, M4A or AAC. Defaults to Original. |

The header shows the resulting duration, format and estimated file size as you adjust. If the file's duration cannot be read, the trim control is hidden and the file uploads whole.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Audio URL — accessible to downstream nodes
## Best Practices

- Use WAV for highest quality, MP3 for smaller file sizes
- Ensure audio is clean and properly recorded for best results with AI nodes

## Common Use Cases

- Source audio for Lip Sync (speech + portrait = talking head)
- Input for Voice Changer or Dubbing
- Audio track for Merge Video & Audio
- Source for Transcribe (speech-to-text)
- Reference audio for the voice changer

## Tips

- For audio from YouTube or video sources, use the Reference Audio node instead
- Connect to Voice Extractor first if the audio has background noise
