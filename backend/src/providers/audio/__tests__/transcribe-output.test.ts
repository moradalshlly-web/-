import { describe, it, expect } from "vitest"
import { mapWhisperOutput, mapFastWhisperOutput } from "../transcribe-output.js"

describe("mapWhisperOutput", () => {
  it("maps openai/whisper output to the handler's output_data shape", () => {
    const out = mapWhisperOutput(
      {
        transcription: "hello world",
        detected_language: "english",
        segments: [{ start: 0, end: 1.5, text: "hello world" }],
      } as never,
      {},
    )
    expect(out).toEqual({
      text: "hello world",
      language: "english",
      segments: [{ start: 0, end: 1.5, text: "hello world" }],
      // The `json` (Transcript) handle — segments carried through in MS, no words.
      json: {
        version: 1,
        language: "english",
        words: [],
        segments: [{ startMs: 0, endMs: 1500, text: "hello world" }],
      },
    })
  })

  it("falls back to 'unknown' language and an empty transcript", () => {
    expect(mapWhisperOutput({} as never, {})).toEqual({
      text: "",
      language: "unknown",
      json: { version: 1, language: "unknown", words: [] },
    })
  })
})

describe("mapFastWhisperOutput", () => {
  it("maps chunk timestamps to segments and honours an explicit language", () => {
    const out = mapFastWhisperOutput(
      { text: "hi", chunks: [{ timestamp: [0, 2], text: "hi" }] } as never,
      { language: "he" },
    )
    expect(out.text).toBe("hi")
    expect(out.language).toBe("he")
    expect(out.segments).toEqual([{ start: 0, end: 2, text: "hi" }])
  })
})

describe("mapFastWhisperOutput — enforceWordTimestamps (provider contract)", () => {
  it("throws when word timings were requested and speech came back word-less", () => {
    // `chunks` absent while `text` is non-empty = the provider answered without
    // honouring `timestamp: "word"`. The live lane fails the job (and refunds)
    // instead of returning `words: []`.
    expect(() =>
      mapFastWhisperOutput({ text: "hello world" } as never, {
        wordTimestamps: true,
        enforceWordTimestamps: true,
      }),
    ).toThrow(/no word timestamps/)
  })

  it("does NOT throw for genuinely empty audio (no chunks, no text)", () => {
    const out = mapFastWhisperOutput({ text: "" } as never, {
      wordTimestamps: true,
      enforceWordTimestamps: true,
    })
    expect(out.text).toBe("")
    expect(out.words).toBeUndefined()
    expect(out.json?.words).toEqual([])
  })

  it("does NOT throw when the words are there", () => {
    const out = mapFastWhisperOutput(
      { text: "hi", chunks: [{ timestamp: [0, 0.5], text: "hi" }] } as never,
      { wordTimestamps: true, enforceWordTimestamps: true },
    )
    expect(out.words).toHaveLength(1)
  })

  it("throws on SENTENCE-level chunks — the break that actually happens", () => {
    // The real failure is not an empty list: the model answers `timestamp:
    // "word"` with sentence chunks, and the mapper (1 caption per chunk, never
    // split) hands back a healthy-looking 2-"word" list for a whole paragraph.
    // Every downstream consumer times one spoken word per entry, so the render
    // is wrong in a way nothing else can see.
    expect(() =>
      mapFastWhisperOutput(
        {
          text: "Hello there. How are you today?",
          chunks: [
            { timestamp: [0, 1.2], text: " Hello there." },
            { timestamp: [1.2, 2.8], text: " How are you today?" },
          ],
        } as never,
        { wordTimestamps: true, enforceWordTimestamps: true },
      ),
    ).toThrow(/no word timestamps/)
  })

  it("accepts the mappers' leading-space word delimiter as word-granular", () => {
    // `" world"` is one word — the leading space is the delimiter the kinetic
    // overlays rely on, not internal whitespace.
    const out = mapFastWhisperOutput(
      {
        text: "hello world",
        chunks: [
          { timestamp: [0, 0.5], text: "hello" },
          { timestamp: [0.5, 1], text: " world" },
        ],
      } as never,
      { wordTimestamps: true, enforceWordTimestamps: true },
    )
    expect(out.words).toHaveLength(2)
  })

  it("does NOT throw on sentence chunks when the contract is not enforced", () => {
    // The reconcile cron rebuilds a stalled row through the same mapper and
    // must recover whatever the provider produced.
    expect(() =>
      mapFastWhisperOutput(
        { text: "Hello there.", chunks: [{ timestamp: [0, 1.2], text: " Hello there." }] } as never,
        { wordTimestamps: true },
      ),
    ).not.toThrow()
  })

  it("stays non-throwing without the flag — the reconcile cron calls the mapper directly", () => {
    // An uncaught throw on the recovery path is only counted by the cron's
    // error tally: the row is never failed, refunded or attempt-bumped, so it
    // would retry identically forever. Recovery keeps today's behaviour.
    expect(() =>
      mapFastWhisperOutput({ text: "hello world" } as never, { wordTimestamps: true }),
    ).not.toThrow()
  })
})

describe("mapWhisperOutput — stays non-throwing for wordTimestamps callers", () => {
  it("returns an empty word list rather than throwing", () => {
    // openai/whisper is rejected upstream (transcribe() refuses the pair), so
    // the only caller that still reaches this with the flag is the reconcile
    // cron rebuilding a pre-existing stalled row — which must recover the
    // transcript it already paid for.
    const out = mapWhisperOutput(
      { transcription: "hello world", detected_language: "en" } as never,
      { wordTimestamps: true },
    )
    expect(out.text).toBe("hello world")
    expect(out.words).toBeUndefined()
  })
})
