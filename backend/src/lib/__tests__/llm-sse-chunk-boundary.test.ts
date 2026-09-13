/**
 * The `responses` SSE lane, measured rather than assumed.
 *
 * Background (Scene3D round 7e, 2026-09-14). The planner's drafts kept being
 * refused at compiler admission for JSON that was corrupt by exactly ONE
 * character, very early in the document — `"seed":370◀▶a086` at position 74,
 * `"keyDirection":[-0.4,-0.6,0.8◀▶}}` at position 330 — and the refusal was
 * charged to the brief as "planner output invalid". A live recording of KIE's
 * `codex/v1/responses` stream for gpt-6-astra explains why a single character
 * is the natural unit of loss there: the answer arrives as
 * `response.output_text.delta` frames of ONE TO THREE characters each (48
 * frames for a 104-character answer), so one lost frame is one lost character.
 *
 * That recording is `fixtures/kie-responses-stream.sse.txt` — a real transcript
 * with its `instructions`/`tools`/echoed-input blobs pruned, keeping every
 * frame, every `sequence_number`, the `obfuscation` padding, the em dash, the
 * emoji, and the `\"` / `\\` / `\n` escapes.
 *
 * Two properties are pinned here:
 *
 *  1. **The parser is boundary-safe.** Replayed split at EVERY byte offset and
 *     at every fixed chunk size 1..8, the reassembled answer is byte-identical
 *     to the unsplit one. This is the disproof of the original hypothesis: the
 *     corruption is not ours.
 *  2. **A stream that loses a frame, or is cut, is now caught.** The provider
 *     restates the answer in `response.output_text.done` / `response.completed`;
 *     that statement wins over the delta reconstruction, a cut stream is a
 *     transport failure rather than a short answer, and a `sequence_number` gap
 *     with nothing to repair from is one too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

vi.mock("../config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({}) }))

const HERE = dirname(fileURLToPath(import.meta.url))
const TRANSCRIPT = readFileSync(join(HERE, "fixtures", "kie-responses-stream.sse.txt"), "utf8")
const TRANSCRIPT_BYTES = new TextEncoder().encode(TRANSCRIPT)

/** The answer the recorded stream carries, read straight out of the fixture. */
const RECORDED_ANSWER =
  '{"a":[1,2,3],"b":"em—dash, emoji 🚀, quote \\"q\\", backslash \\\\, newline\\nend","c":{"d":[-0.4,-0.6,0.8]}}'

/** The responses-dialect model the Scene3D planner runs on. */
const MODEL = "gpt-6-astra"

function responseFrom(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function textChunks(...parts: string[]): Uint8Array[] {
  const encoder = new TextEncoder()
  return parts.map((p) => encoder.encode(p))
}

describe("responses SSE: byte-boundary safety and stream integrity", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function replay(chunks: Uint8Array[]): Promise<{ text: string; streamed: string }> {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(responseFrom(chunks))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: MODEL, system: "", messages: [{ role: "user", content: "x" }] },
      (t) => tokens.push(t),
    )
    return { text: res.text, streamed: tokens.join("") }
  }

  it("reassembles the recorded stream exactly when delivered as one chunk", async () => {
    const { text, streamed } = await replay([TRANSCRIPT_BYTES])
    expect(text).toBe(RECORDED_ANSWER)
    // The delta reconstruction on a clean stream agrees with the provider's own
    // statement — which is what makes a DISAGREEMENT meaningful evidence.
    expect(streamed).toBe(RECORDED_ANSWER)
  })

  it("reassembles identically when split at EVERY byte offset", async () => {
    const total = TRANSCRIPT_BYTES.length
    const bad: number[] = []
    let cuts = 0
    for (let cut = 1; cut < total; cut++) {
      const { text } = await replay([TRANSCRIPT_BYTES.subarray(0, cut), TRANSCRIPT_BYTES.subarray(cut)])
      cuts++
      if (text !== RECORDED_ANSWER) bad.push(cut)
      if (bad.length > 4) break
    }
    expect(bad).toEqual([])
    // The sweep must not be able to pass by not running.
    expect(cuts).toBe(total - 1)
    expect(total).toBeGreaterThan(10_000)
  }, 120_000)

  it("reassembles identically at every fixed chunk size 1..8 bytes", async () => {
    for (let size = 1; size <= 8; size++) {
      const chunks: Uint8Array[] = []
      for (let i = 0; i < TRANSCRIPT_BYTES.length; i += size) {
        chunks.push(TRANSCRIPT_BYTES.subarray(i, Math.min(i + size, TRANSCRIPT_BYTES.length)))
      }
      const { text } = await replay(chunks)
      expect({ size, text }).toEqual({ size, text: RECORDED_ANSWER })
    }
  }, 120_000)

  it("accepts a `data:` line with no space after the colon (the space is optional in SSE)", async () => {
    const { text } = await replay(
      textChunks(
        'data:{"type":"response.output_text.delta","delta":"hi","sequence_number":0}\n\n',
        'data:{"type":"response.completed","sequence_number":1,"response":{"output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      ),
    )
    expect(text).toBe("hi")
  })
})

describe("responses SSE: the provider's stated answer beats the delta reconstruction", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function replay(...parts: string[]) {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(responseFrom(textChunks(...parts)))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: MODEL, system: "", messages: [{ role: "user", content: "x" }] },
      (t) => tokens.push(t),
    )
    return res
  }

  const completed = (text: string, sequence = 9) =>
    `data: ${JSON.stringify({
      type: "response.completed",
      sequence_number: sequence,
      response: {
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    })}\n\n`

  const delta = (text: string, sequence: number) =>
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text, sequence_number: sequence })}\n\n`

  it("repairs a dropped one-character delta frame from `response.completed`", async () => {
    // Exactly the Scene3D shape: the `]` never arrives as a delta, so the
    // reconstruction is `[-0.4,-0.6,0.8}}` — one character short, and invalid
    // JSON at the same kind of offset the planner kept being blamed for.
    const answer = '{"k":[-0.4,-0.6,0.8]}'
    const res = await replay(
      delta('{"k":[-0.4,', 0),
      delta("-0.6,", 1),
      delta("0.8", 2),
      delta("}", 4), // the frame carrying `]` was lost — note the sequence gap
      completed(answer),
    )
    expect(res.text).toBe(answer)
    expect(JSON.parse(res.text)).toEqual({ k: [-0.4, -0.6, 0.8] })
    expect(warn.mock.calls.flat().join(" ")).toMatch(/llm-kie-stream-mismatch/)
  })

  it("falls back to `response.output_text.done` when the stream states no completed response", async () => {
    const answer = '{"k":1}'
    const res = await replay(
      delta('{"k":', 0),
      `data: ${JSON.stringify({ type: "response.output_text.done", text: answer, sequence_number: 1 })}\n\n`,
      "data: [DONE]\n\n",
    )
    expect(res.text).toBe(answer)
  })

  it("does not warn when the reconstruction already agrees with the stated answer", async () => {
    const res = await replay(delta('{"k":', 0), delta("1}", 1), completed('{"k":1}', 2))
    expect(res.text).toBe('{"k":1}')
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/llm-kie-stream-mismatch/)
  })

  it("rejects a stream cut mid-answer instead of returning the truncated draft", async () => {
    // No `response.completed`, no `[DONE]` — the 14,414-character-cut shape.
    await expect(replay(delta('{"k":[1,2', 0), delta(",3", 1))).rejects.toThrow(/cut mid-answer/i)
  })

  it("rejects a sequence gap that no stated answer can repair", async () => {
    await expect(
      replay(delta('{"k":1', 0), delta("}", 3), "data: [DONE]\n\n"),
    ).rejects.toThrow(/lost or reordered an SSE frame/i)
  })
})

describe("reconcileResponsesStreamText", () => {
  const base = { modelId: "m", sawStreamEnd: true, sequenceAnomaly: false }

  it("returns the streamed text when nothing authoritative was stated", async () => {
    const { reconcileResponsesStreamText } = await import("../llm-client.js")
    expect(reconcileResponsesStreamText({ ...base, streamedText: "abc", authoritativeText: undefined })).toBe("abc")
  })

  it("prefers an authoritative EMPTY answer over a non-empty reconstruction", async () => {
    const { reconcileResponsesStreamText } = await import("../llm-client.js")
    // `undefined` means "never stated"; "" means "stated as empty" — the
    // distinction is why responsesFrameText returns undefined rather than "".
    expect(reconcileResponsesStreamText({ ...base, streamedText: "abc", authoritativeText: "" })).toBe("")
  })

  it("throws on a cut stream even when some text arrived", async () => {
    const { reconcileResponsesStreamText } = await import("../llm-client.js")
    expect(() =>
      reconcileResponsesStreamText({ ...base, sawStreamEnd: false, streamedText: "abc", authoritativeText: undefined }),
    ).toThrow(/cut mid-answer/i)
  })

  it("a sequence gap is harmless once the answer was stated", async () => {
    const { reconcileResponsesStreamText } = await import("../llm-client.js")
    expect(
      reconcileResponsesStreamText({ ...base, sequenceAnomaly: true, streamedText: "ab", authoritativeText: "abc" }),
    ).toBe("abc")
  })
})
