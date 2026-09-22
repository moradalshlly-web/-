---
"@nodaro/sdk": minor
---

`media.addCaptions()` gains `maxWordsPerLine`, and `audio.transcribe()` takes
every engine the route does.

`maxWordsPerLine` (1-20) caps how many words one caption LINE — or one
`tiktok-words` page — may hold, on top of the frame-width budget, sentence ends
and pauses that already close a line; 1-2 gives the short, punchy read, and an
unset value fits the width as before. It lives on `CaptionLookInput`, so it
exists top-level AND on every `segments[]` entry, and a segment that does not
name its own inherits the top-level value. It applies to `word-highlight`,
`karaoke`, `bouncy` and `tiktok-words`, and — like the other STYLING levers — to
the static `subtitle` style, which then renders through Remotion (the only path
that groups lines at all). It is inert on `word-pop`, which is always one word.

`audio.transcribe()`'s `provider` is `TranscribeProvider`, which now accepts
`elevenlabs-stt`, `whisper` and `incredibly-fast-whisper` — the re-widened
`/v1/transcribe` enum. Only the type moved; the capability did not, and the
JSDoc now says which is which: `whisper` returns NO word timings whether you
name it or reach it by omitting `provider`, so asking it for them
(`wordTimestamps: true`) is a `400` at ingress, while `elevenlabs-stt` (always
word-level, and the lane that honours `diarize` / `tagAudioEvents`) and
`incredibly-fast-whisper` can answer. A word-timed caption render has to name
one of those two.

Additive — no existing call changes shape.
