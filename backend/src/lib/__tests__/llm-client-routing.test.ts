import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-anthropic-key", NODE_ENV: "test" },
}))
const createSpy = vi.fn()
const streamSpy = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
const kieOk = () => jsonResponse({ content: [{ type: "text", text: "kie" }], usage: { input_tokens: 1, output_tokens: 1 } })
const anthropicOk = { content: [{ type: "text", text: "direct" }], usage: { input_tokens: 1, output_tokens: 1 } }

/** A Response whose body is an SSE stream yielding the given raw chunks, then closing. */
function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/**
 * SSE stream that delivers one valid chunk then dies mid-stream — the SECOND
 * pull() throws. Distinct from a stream that fails before any data ever
 * arrives (use `streamResponse` with the `{code,msg}` JSON envelope for that).
 */
function streamThatFailsAfterFirstChunk(firstChunk: string): Response {
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (pulls === 1) {
        controller.enqueue(new TextEncoder().encode(firstChunk))
        return
      }
      throw new Error("stream broke mid-way")
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/**
 * Minimal stand-in for the Anthropic SDK's `messages.stream(...)` return value —
 * implements only what `streamAnthropicDirect` consumes: `.on("text", cb)` and
 * `.finalMessage()`.
 */
function anthropicStreamStub(text: string, usage = { input_tokens: 4, output_tokens: 4 }) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") cb(text)
      return this
    },
    abort() {},
    finalMessage: () => Promise.resolve({ usage }),
  }
}

describe("preferKie routing (claude-sonnet-5 / claude-opus-4.8)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); createSpy.mockReset().mockResolvedValue(anthropicOk) })
  afterEach(() => { vi.unstubAllGlobals() })

  // KIE's Claude proxy 500s on EVERY non-streaming request, model-independently
  // (measured 2026-08-06 — see KIE_CLAUDE_NONSTREAM_VERIFIED). llmComplete is
  // the non-streaming entry point, so `preferKie` cannot apply here until that
  // flag flips back; the KIE leg would be a guaranteed 500 before the fallback.
  it("plain non-streaming call goes direct — KIE's non-stream Claude lane is down", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())
    const res = await llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct")
  })

  // The reported symptom was "all Opus 5 calls fail on KIE". The outage is the
  // LANE, not the model — so every Claude model must leave the non-stream KIE
  // path, and swapping opus-5 for opus-4.8 would have fixed nothing.
  it.each(["claude-opus-5", "claude-opus-4.8", "claude-fable-5", "claude-sonnet-5", "claude-opus-4.7"])(
    "%s never touches the non-streaming KIE lane",
    async (modelId) => {
      const { llmComplete } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(kieOk())
      const res = await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "hi" }] })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(createSpy).toHaveBeenCalledOnce()
      expect(res.text).toBe("direct")
    },
  )

  // The direct lane is primary but not incident-free (Anthropic logged four
  // elevated-error incidents across 2026-08-04/05, two naming Opus 5). KIE's
  // STREAMING wire still works while its non-streaming one 500s, so collapsing
  // a stream gives llmComplete a real second lane rather than none.
  it("falls back to KIE's collapsed stream when the direct lane fails", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic 529 overloaded"))
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"from-"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"kie-stream"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":4}}\n',
      ]),
    )
    const res = await llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(createSpy).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(res.text).toBe("from-kie-stream")
    // It must use the wire that WORKS — a stream:false body would 500 on KIE.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.stream).toBe(true)
  })

  // Over SSE a forced tool arrives as real input_json_delta fragments, not the
  // malformed <tool_calls> pseudo-tag the non-streaming path has to decode.
  it("reassembles forced-tool JSON from the collapsed stream", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"r"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"ok\\":"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"true}"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
      ]),
    )
    const res = await llmComplete({
      modelId: "claude-opus-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: { name: "r", schema: { type: "object" } },
    })
    expect(res.text).toBe('{"ok":true}')
    expect(JSON.parse(res.text)).toEqual({ ok: true })
  })

  // KIE's Claude stream fails transiently ~1 call in 5, almost always as one
  // `event: error` frame that a retry clears. The backstop only runs because
  // direct already failed, so it gets exactly one more attempt.
  it("retries the collapsed stream once past a transient KIE error frame", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(
        streamResponse(['event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception"}}\n']),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"type":"content_block_delta","delta":{"text":"recovered"}}\n',
          'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
        ]),
      )
    const res = await llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(res.text).toBe("recovered")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("surfaces the error when BOTH lanes fail — no empty-success, and the retry is bounded", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
    vi.useFakeTimers()
    try {
      const call = llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }] })
      const assertion = expect(call).rejects.toThrow()
      // Drive the 400 / 2 000 / 6 000 ms transport ladder without sitting it out.
      await vi.advanceTimersByTimeAsync(20_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    // One initial attempt plus the bounded ladder — a genuinely down proxy still
    // fails inside seconds rather than looping.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("falls back to direct Anthropic when KIE errors", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: "maintenance" }))
    const res = await llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(createSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct")
  })

  // KIE_CLAUDE_TOOLS_VERIFIED = true, so forced tools are no longer what pushes
  // structured calls direct — the non-stream outage is. Same destination,
  // different reason; this pins that structured calls carry the forced tool on
  // the DIRECT wire.
  it("structured requests go direct and still force the tool", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockResolvedValue({
      content: [{ type: "tool_use", name: "r", input: { ok: true } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const res = await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: { name: "r", schema: { type: "object" } },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()

    // The forced-tool schema must actually be carried on the wire.
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    const tools = body.tools as Array<Record<string, unknown>>
    expect(tools[0].name).toBe("r")
    expect(body.tool_choice).toEqual({ type: "tool", name: "r" })

    expect(res.text).toBe(JSON.stringify({ ok: true }))
  })

  it("existing Claude models still go direct-first", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
  })

  // Thinking/output_config passthrough through the KIE proxy is NOT verified,
  // so effort-carrying calls still route direct per
  // KIE_CLAUDE_EFFORT_VERIFIED = false.
  it("effort-carrying call goes direct while KIE effort passthrough is unverified", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
  })
})

describe("llmStream preferKie routing (claude-sonnet-5)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset().mockResolvedValue(anthropicOk)
    streamSpy.mockReset()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("plain streaming call goes to KIE first — each SSE token reaches the callback exactly once", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"He"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"llo"}}\n',
        "data: [DONE]\n",
      ]),
    )
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/claude/v1/messages")
    expect(createSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He", "llo"])
    expect(res.text).toBe("Hello")
  })

  it("KIE stream fails BEFORE any token → falls back to direct", async () => {
    const { llmStream } = await import("../llm-client.js")
    // The envelope guard throws pre-token, same shape as the existing non-stream test.
    fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
    streamSpy.mockReturnValue(anthropicStreamStub("direct-stream-text"))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(tokens).toEqual(["direct-stream-text"])
    expect(res.text).toBe("direct-stream-text")
  })

  // KIE's Claude stream can emit an `event: error` frame instead of content
  // (observed in 1 of 6 plain requests, 2026-08-06). That frame matches no
  // format branch, so before the fix the stream ended with fullText === "" and
  // was returned as a SUCCESSFUL empty completion — no throw, so the fallback
  // never ran and the user got a blank answer.
  it("KIE stream error event before any token → throws, so the direct fallback runs", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception, please try again later"}}\n',
      ]),
    )
    streamSpy.mockReturnValue(anthropicStreamStub("direct-stream-text"))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct-stream-text")
    expect(tokens).toEqual(["direct-stream-text"])
  })

  it("KIE stream error event AFTER a token → surfaces, never returns a truncated success", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"He"}}\n',
        'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception, please try again later"}}\n',
      ]),
    )
    const tokens: string[] = []
    await expect(
      llmStream(
        { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
        (t) => tokens.push(t),
      ),
    ).rejects.toThrow(/error event/)
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He"])
  })

  it("KIE stream fails AFTER >=1 token → error rethrown, no direct fallback, first token delivered exactly once", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamThatFailsAfterFirstChunk('data: {"type":"content_block_delta","delta":{"text":"He"}}\n'),
    )
    const tokens: string[] = []
    await expect(
      llmStream(
        { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
        (t) => tokens.push(t),
      ),
    ).rejects.toThrow()
    expect(createSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He"])
  })

  it("structured streaming request goes direct — streamed forced-tool output is not parsed on the KIE path", async () => {
    const { llmStream } = await import("../llm-client.js")
    // Configured so that if the fix regresses and this DOES hit KIE, the test
    // fails on the `fetchMock not called` assertion rather than an opaque throw.
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [{ type: "tool_use", input: { unexpected: true } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    streamSpy.mockReturnValue(anthropicStreamStub('{"ok":true}'))
    const tokens: string[] = []
    const res = await llmStream(
      {
        modelId: "claude-sonnet-5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        jsonSchema: { name: "r", schema: { type: "object" } },
      },
      (t) => tokens.push(t),
    )
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokens).toEqual(['{"ok":true}'])
    expect(res.text).toBe('{"ok":true}')
  })
})
