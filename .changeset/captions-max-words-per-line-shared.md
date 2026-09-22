---
"@nodaro/shared": minor
---

Captions: a words-per-line cap, and the pre-run checks for a transcript that
carries no word timings.

`CAPTION_MAX_WORDS_PER_LINE_MIN` / `CAPTION_MAX_WORDS_PER_LINE_MAX` (1-20) are
the single source for the new `maxWordsPerLine` lever's bounds — the route Zod,
the render plan, the MCP schema, the CLI and the canvas panel all read them
here rather than repeating a pair of numbers. The lever caps how many words one
caption LINE (or `tiktok-words` page) may hold, on TOP of the frame-width
budget, sentence ends and pauses that already close a line; 1-2 gives the short,
punchy read. It applies to `word-highlight`, `karaoke`, `bouncy`, `tiktok-words`
and to a Remotion-rendered `subtitle`, and is inert on `word-pop`, which is
always one word. It is a STYLING lever, not a kinetic-only one, so
`captionRoutesToRemotion()` now counts it alongside `look` / `fontFamily` /
`fontWeight` / `strokeColor` / `strokeWidth` / `uppercase` / `positionY`: a
`subtitle` carrying it renders through Remotion, which is the only path that can
group lines at all.

`TRANSCRIBE_PROVIDERS` is `["elevenlabs-stt", "whisper",
"incredibly-fast-whisper"]` again — all three lanes are served, and the canvas
picker had re-offered the two Replicate ones while this enum still hid them, so
a single-node Run on Whisper 400'd where the same node in a workflow Run worked.
Capabilities are unchanged and still answered by
`TRANSCRIBE_PROVIDER_CAPABILITIES`: `whisper` returns NO per-word timings,
`incredibly-fast-whisper` and `elevenlabs-stt` do. A wider enum is not a wider
capability, and nothing should match on a provider name to decide.

Two new helpers make the word-timing gap visible BEFORE a run instead of after a
paid transcription:

- `transcribeWordTimestampsRefusal(provider)` — the one refusal message for a
  lane that cannot return word timings, `null` for a lane that can. An absent
  provider resolves to the transcribe node's default (`elevenlabs-stt`), so the
  helper answers for node data as honestly as for a wire body.
- `findWordlessTranscriptFeeds(nodes, edges)` — a GRAPH check: it finds every
  transcribe node sitting on a word-incapable lane whose `json` output reaches an
  add-captions `transcript` input, directly or through an apply-edl hop. Each hit
  names `{ transcribeNodeId, consumerNodeId, provider, message }`, so a canvas,
  an import or an agent-authored workflow can say which two nodes disagree
  before the run starts.

Structural vocabulary only — no creative content, no behaviour change inside the
package.
