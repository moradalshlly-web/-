/**
 * What the direct Google lane is told about the SHAPE of a structured answer.
 *
 * Google compiles `responseJsonSchema` into a constrained decoder with a state
 * budget, and an array cap multiplies that budget by its bound. Measured
 * 2026-09-18 against `gemini-3.7-flash`: a schema with nested `maxItems`
 * (32 × 24, plus 48 and 24) is refused outright — a bare
 * `400 INVALID_ARGUMENT` in ~2 s, no usage, no hint at which keyword — while
 * the SAME request with only `maxItems` removed answers in ~7 s and passes the
 * caller's Zod. `maxLength`, `minimum`/`maximum`, `minItems` and the thinking
 * level were each varied alone and are irrelevant. Every scene3d job with a
 * video reference failed on it, three queue attempts each.
 *
 * The cap is not lost by withholding it: `llmCompleteStructured` re-validates
 * every answer against the caller's Zod schema, which still carries it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { z } from "zod"

const generateContent = vi.fn()
const generateContentStream = vi.fn()

vi.mock("../../config.js", () => ({
  config: {
    GEMINI_API_KEY: "test-gemini-key",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  generateContentStream.mockReset()
})

describe("toGeminiResponseSchema", () => {
  it("withholds every array cap, at any depth, and keeps the rest of the schema", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["subjects"],
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 1000 },
        subjects: {
          type: "array", minItems: 1, maxItems: 32,
          items: {
            type: "object",
            properties: {
              at: { type: "number", minimum: 0, maximum: 60 },
              motion: { type: "array", maxItems: 24, items: { type: "string" } },
            },
          },
        },
        either: { anyOf: [{ type: "array", maxItems: 3, items: { type: "string" } }, { type: "null" }] },
      },
    }

    expect(toGeminiResponseSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["subjects"],
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 1000 },
        subjects: {
          type: "array", minItems: 1,
          items: {
            type: "object",
            properties: {
              at: { type: "number", minimum: 0, maximum: 60 },
              motion: { type: "array", items: { type: "string" } },
            },
          },
        },
        either: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
      },
    })
  })

  it("keeps a PROPERTY that happens to be named maxItems — that is data, not a keyword", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = {
      type: "object",
      properties: { maxItems: { type: "integer" }, list: { type: "array", maxItems: 5 } },
      required: ["maxItems"],
    }
    expect(toGeminiResponseSchema(schema)).toEqual({
      type: "object",
      properties: { maxItems: { type: "integer" }, list: { type: "array" } },
      required: ["maxItems"],
    })
  })

  it("never mutates the caller's schema — it is also the request's fingerprint", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = { type: "array", maxItems: 4, items: { type: "array", maxItems: 2 } }
    const before = JSON.stringify(schema)
    toGeminiResponseSchema(schema)
    expect(JSON.stringify(schema)).toBe(before)
  })
})

describe("the wire: no array cap reaches Google on either call shape", () => {
  const brief = z.object({
    camera: z.array(z.object({ movement: z.string().max(1000) }).strict()).min(1).max(24),
    subjects: z.array(z.object({
      id: z.string(),
      motion: z.array(z.object({ description: z.string() }).strict()).max(24),
    }).strict()).max(32),
  }).strict()
  const answer = { camera: [{ movement: "dolly in" }], subjects: [] }

  it("llmCompleteStructured on the pinned direct lane", async () => {
    const { llmCompleteStructured } = await import("../../llm-client.js")
    generateContent.mockResolvedValue({
      text: JSON.stringify(answer),
      usageMetadata: { promptTokenCount: 1636, candidatesTokenCount: 883 },
    })

    const result = await llmCompleteStructured({
      modelId: "gemini-3.7-flash", system: "", requireLane: "direct",
      messages: [{ role: "user", content: "analyse" }],
    }, brief, { schemaName: "scene3d_video_reference", maxRetries: 0 })

    expect(result.output).toEqual(answer)
    const sent = generateContent.mock.calls[0]![0] as { config: { responseJsonSchema: unknown } }
    const wire = JSON.stringify(sent.config.responseJsonSchema)
    expect(wire).not.toContain("maxItems")
    // Everything that steers the decoder without multiplying its states stays.
    expect(wire).toContain('"minItems":1')
    expect(wire).toContain('"maxLength":1000')
    expect(wire).toContain('"additionalProperties":false')
  })

  it("the streaming builder shares the same config", async () => {
    const { llmStream } = await import("../../llm-client.js")
    generateContentStream.mockResolvedValue((async function* () {
      yield { text: "{}", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }
    })())

    await llmStream({
      modelId: "gemini-3.7-flash", system: "", requireLane: "direct",
      messages: [{ role: "user", content: "analyse" }],
      jsonSchema: { name: "x", schema: { type: "array", maxItems: 9, items: { type: "string" } } },
    }, () => {})

    const sent = generateContentStream.mock.calls[0]![0] as { config: { responseJsonSchema: unknown } }
    expect(sent.config.responseJsonSchema).toEqual({ type: "array", items: { type: "string" } })
  })
})
