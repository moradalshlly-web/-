import { describe, it, expect } from "vitest"
import { createTikTokStyleCaptions } from "@remotion/captions"
import { scribeWordsToCaptions } from "../captions-mappers.js"

/**
 * Direct ElevenLabs Scribe returns bare word tokens (its `spacing` entries are
 * dropped by the client). The @remotion/captions spec uses a LEADING SPACE on a
 * word's `text` as the word delimiter: the kinetic overlays render adjacent
 * `<span>`s with the text verbatim and createTikTokStyleCaptions concatenates
 * `text`. Bare tokens therefore burned in as "Twopeopletalking" on every
 * elevenlabs-stt add-captions run. The mapper is the one seam that shapes
 * Scribe words for the captions wire contract.
 */
describe("scribeWordsToCaptions", () => {
  const scribe = [
    { text: "Two", start: 0.1, end: 0.3, speaker: "speaker_0" },
    { text: "people", start: 0.35, end: 0.6, speaker: "speaker_0" },
    { text: "talking", start: 0.65, end: 1.0, speaker: "speaker_0" },
  ]

  it("prefixes every word after the first with the leading-space delimiter", () => {
    expect(scribeWordsToCaptions(scribe).map((w) => w.text)).toEqual(["Two", " people", " talking"])
  })

  it("keeps ms timings, the null caption fields and the speaker", () => {
    expect(scribeWordsToCaptions(scribe)[1]).toEqual({
      text: " people",
      startMs: 350,
      endMs: 600,
      timestampMs: null,
      confidence: null,
      speaker: "speaker_0",
    })
  })

  it("does not double a delimiter a token already carries, and omits speaker when empty", () => {
    const out = scribeWordsToCaptions([
      { text: "hi", start: 0, end: 0.2 },
      { text: " there", start: 0.2, end: 0.4, speaker: "" },
    ])
    expect(out.map((w) => w.text)).toEqual(["hi", " there"])
    expect("speaker" in out[1]).toBe(false)
  })

  it("joins into readable pages through @remotion/captions (the consumer that broke)", () => {
    const { pages } = createTikTokStyleCaptions({
      captions: scribeWordsToCaptions(scribe),
      combineTokensWithinMilliseconds: 5000,
    })
    expect(pages.map((p) => p.text)).toEqual(["Two people talking"])
  })
})
