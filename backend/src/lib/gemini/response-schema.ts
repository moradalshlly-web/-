/**
 * The caller's JSON Schema → the one Google is asked to decode against.
 *
 * `responseJsonSchema` is compiled into a constrained decoder with a state
 * budget, and an array cap multiplies that budget by its bound. A schema that
 * nests a few of them is refused before any token is produced: a bare
 * `400 INVALID_ARGUMENT` that names no keyword, reports no usage, and is
 * identical on every retry. Measured 2026-09-18 on `gemini-3.7-flash` with the
 * scene3d video-reference schema (caps of 32 × 24, 48 and 24): removing ONLY
 * `maxItems` turned the refusal into a ~7 s answer that passed the caller's
 * Zod. `minItems`, `minLength`/`maxLength`, `minimum`/`maximum` and
 * `additionalProperties` were each varied alone and do not contribute, so they
 * stay — they steer the decoder toward a valid answer at no such cost.
 *
 * Withholding the cap does not drop it. `llmCompleteStructured` validates every
 * answer against the caller's Zod schema, which still carries it; the wire
 * schema only ever needed to be a SUPERSET of what the caller accepts.
 *
 * Done here rather than per schema so no caller has to know this about one
 * lane: a plugin's schema is also its request fingerprint and its contract on
 * the KIE and Anthropic lanes, none of which share this limit.
 */

/** Keywords withheld from Google. Closed and measured — extend it with a repro, not a guess. */
const WITHHELD_KEYWORDS: ReadonlySet<string> = new Set(["maxItems"])

/**
 * Keywords whose value is a map of NAME → subschema. Its keys are the caller's
 * own identifiers, so a property called `maxItems` must survive; only the
 * subschemas beneath it are rewritten.
 */
const NAME_KEYED: ReadonlySet<string> = new Set(["properties", "patternProperties", "definitions", "$defs", "dependencies"])

export function toGeminiResponseSchema(schema: unknown): unknown {
  return rewrite(schema, false)
}

function rewrite(node: unknown, keysAreNames: boolean): unknown {
  if (Array.isArray(node)) return node.map((entry) => rewrite(entry, false))
  if (node === null || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (!keysAreNames && WITHHELD_KEYWORDS.has(key)) continue
    out[key] = rewrite(value, !keysAreNames && NAME_KEYED.has(key))
  }
  return out
}
