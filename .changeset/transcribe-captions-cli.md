---
"@nodaro/cli": minor
"@nodaro/shared": patch
---

Add the two commands that make the transcribe → captions path runnable from a
terminal:

- `nodaro audio transcribe --audio <url>` — speech to text (`--provider`,
  `--language`, `--diarize`, `--tag-audio-events`, `--word-timestamps`). The
  flag shape follows the rest of the `audio` group, which takes its source as
  `--audio <url>`. `--word-timestamps` on a lane that cannot produce them is
  refused locally with the same verdict the route gives, and the message names
  only providers this command would itself accept.
- `nodaro media add-captions <videoUrl>` — burn captions in (`--text`,
  `--captions-file`, `--style`, `--look`, `--position`, `--position-y`,
  `--font-size`, `--font-family`, `--font-weight`, `--color`,
  `--background-color`, `--stroke-color`, `--stroke-width`,
  `--highlight-color`, `--uppercase`, `--no-auto-transcribe`,
  `--transcribe-provider`, `--segments-file`). `--captions-file` takes a JSON
  array of word-timed entries — an `audio transcribe` job's `output_data.words`
  drops in verbatim — and `--segments-file` gives non-overlapping ranges their
  own treatment. Both file inputs are array-guarded with a friendly message
  naming the flag, like `edit plan --sources-file`.

Each is a thin wrapper over the SDK (`client.audio.transcribe` /
`client.media.addCaptions`) and honours the CLI's multi-profile auth, `--json`
and `--watch` conventions. Every enum a flag validates against is read from
`@nodaro/shared` (`ALL_CAPTION_STYLES`, `CAPTION_LOOK_IDS`,
`SUPPORTED_FONT_NAMES`, `TRANSCRIBE_PROVIDERS`, `TRANSCRIBE_LANES`) rather than
re-listed here, so a new style, look, face or lane needs no CLI edit. The two
provider flags read DIFFERENT enums on purpose — `--provider` on transcribe the
caller-facing `TRANSCRIBE_PROVIDERS`, add-captions' `--transcribe-provider` every
`TRANSCRIBE_LANES` member — each matching what its own route's Zod accepts. The
two sets hold the same three lanes today; they have diverged before, and reading
them separately is what lets them diverge again with no CLI edit.

The `@nodaro/shared` patch bump carries no source change: it exists only to lift
the CLI's `@nodaro/shared` floor to a version that ships `TRANSCRIBE_LANES` and
the capability helpers. The commands VALUE-import those symbols, so pairing this
CLI with an older shared would make the validation read `undefined` at runtime —
the bump rewrites the dependency range so a consumer can never resolve that
stale sibling.
