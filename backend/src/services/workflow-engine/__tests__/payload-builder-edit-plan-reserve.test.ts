import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"

// Mirrors payload-builder-ltx-credit-id.test.ts's harness: buildPayload is a
// pure function of (node, jobId, resolvedInputs, usageLogId, ctx) — no mocks.
//
// Regression: an orchestrated edit-plan run whose MASTER source is a
// reference-audio / youtube (or direct-URL) node exposes NO duration on its
// node data at reserve time (its length isn't known until the audio is
// fetched, and its live orchestrator output is a bare URL). The reserve used to
// bucket to the 180-minute CEILING — `edit-plan:tighten:standard:180m` (base
// 720; at a 10% cost_markup_percent that rounds 720×1.1 = 792.0000000000001 up
// to the 793 the user was charged — the only percent that produces it via the
// IEEE-754 ceil) — instead of the 60m bucket a ~59-min episode belongs in
// (base 240).
//
// THIS file pins the buildPayload FALLBACK beneath the probe-at-reserve: the
// authoritative reserve basis is `computeEditPlanReserveId`'s ffprobe of the
// master (see lib/__tests__/edit-plan-pricing.test.ts), but buildPayload cannot
// ffprobe, so it reserves on the master source node's own duration when it has
// one, else the transcript's own clock (a required input and the timing map of
// that same master), else the ceiling. That transcript basis is what stands
// when the reserve-path probe can't run (unprobeable/unreachable master).

const ctx = { nodes: [], edges: [], nodeStates: {} }

const node = (data: Record<string, unknown>) => ({
  id: "ep1",
  type: "edit-plan",
  data: { mode: "tighten", planTier: "standard", ...data },
})

const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown>) =>
  buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

// A 59.4-minute episode's transcript: last word ends at 3,564,000 ms.
const transcript59m = {
  version: 1,
  words: [
    { text: "welcome", startMs: 0, endMs: 800 },
    { text: "goodbye", startMs: 3_563_000, endMs: 3_564_000 },
  ],
}

// The reference-audio source row as input-resolver builds it: nodeId + url +
// kind, and CRITICALLY no `duration` key (the node exposes none).
const urlSourceRow = { nodeId: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" as const }

describe("edit-plan orchestrated reserve — URL/reference-audio master buckets by transcript", () => {
  it("a ~59-min episode reserves the 60m bucket, not the 180m ceiling", () => {
    const out = build(
      {},
      { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
    )
    // Was `edit-plan:tighten:standard:180m` (base 720 → 793 charged). Now 60m.
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
    expect((out.payload as { reservedCreditId?: string }).reservedCreditId).toBe(
      "edit-plan:tighten:standard:60m",
    )
  })

  it("an inline (non-stringified) transcript object works too", () => {
    const out = build({}, { transcript: transcript59m, editPlanSources: [urlSourceRow] })
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
  })

  it("the source node's OWN duration wins over the transcript when present", () => {
    // upload-audio master with a known 20-min length → the 30m bucket, even
    // though the transcript would imply 60m — the media length is authoritative.
    const out = build(
      {},
      {
        transcript: JSON.stringify(transcript59m),
        editPlanSources: [{ ...urlSourceRow, duration: 20 * 60 }],
      },
    )
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:30m")
  })

  it("mode/tier still drive the composite (chapters + premium)", () => {
    const out = build(
      { mode: "chapters", planTier: "premium" },
      { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
    )
    expect(out.modelIdentifier).toBe("edit-plan:chapters:premium:60m")
  })

  it("an empty transcript falls to the ceiling — the safe over-reserve direction", () => {
    const out = build(
      {},
      { transcript: JSON.stringify({ version: 1, words: [] }), editPlanSources: [urlSourceRow] },
    )
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:180m")
  })
})
