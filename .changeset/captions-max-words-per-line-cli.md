---
"@nodaro/cli": minor
---

`nodaro media add-captions` gains `--max-words-per-line <n>`, and `nodaro audio
transcribe --provider` offers every engine the route accepts.

`--max-words-per-line` caps the words on one caption line (or `tiktok-words`
page) on top of the width budget, sentence ends and pauses that already close
one. The bounds come from `@nodaro/shared`
(`CAPTION_MAX_WORDS_PER_LINE_MIN`/`_MAX`, 1-20) rather than a pair of numbers
repeated here, and the flag is validated before anything is read or sent: a
value outside the range, or one that is not a whole number, is refused locally
with a message quoting what was typed — `--max-words-per-line 2.5` says 2.5
rather than silently running as 2. An omitted flag sends nothing, so the server
default still decides. It works on the static `subtitle` style too, and a
`--segments-file` entry naming its own cap overrides it for that range.

`--provider` on `audio transcribe` reads the re-widened `TRANSCRIBE_PROVIDERS`,
so all three lanes are offered. The `--word-timestamps` refusal is unchanged in
shape and still asks the shared capability table rather than matching on a
provider name — but now that `whisper` is an accepted provider again, it is the
CAPABILITY that refuses it, and the message names both lanes that can answer
(`elevenlabs-stt`, `incredibly-fast-whisper`). The flag's help text says the
same: `whisper` returns no word timings whether it is named or reached by
omitting the flag.
