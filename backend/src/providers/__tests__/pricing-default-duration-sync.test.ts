import { describe, it, expect } from "vitest"
import { DURATION_PRICED_PROVIDERS, PRICING_DEFAULT_DURATION_SEC, buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../kie/models.js"

/**
 * #1397 — the invariant behind `PRICING_DEFAULT_DURATION_SEC`: a request that
 * names a provider but omits `duration` renders the provider's OWN default
 * (`extraParams.duration` in kie/models.ts is what the wire carries when the
 * caller sent none), and `commit_credits` can only refund, so the tier it is
 * priced at must be the tier that default lands on. A provider whose per-
 * second ladder does not snap the 5s fallback up to its default needs an entry
 * in the map — this is what catches the next one.
 */
function renderDefaultSec(provider: string): number | undefined {
  const cfg = KIE_VIDEO_MODELS[provider] ?? KIE_TEXT_TO_VIDEO_MODELS[provider]
  const d = cfg?.extraParams?.duration
  return typeof d === "number" && Number.isFinite(d) ? d : undefined
}

describe("an omitted duration is priced at the length the provider renders", () => {
  it("every PRICING_DEFAULT_DURATION_SEC entry equals the KIE config's own default render length", () => {
    for (const [provider, sec] of Object.entries(PRICING_DEFAULT_DURATION_SEC)) {
      expect(renderDefaultSec(provider), `${provider}: map says ${sec}s, kie/models.ts extraParams.duration`).toBe(sec)
    }
  })

  it("every duration-priced KIE video model with a declared default prices an omitted duration at that default's tier", () => {
    const offenders: string[] = []
    for (const provider of DURATION_PRICED_PROVIDERS) {
      const d = renderDefaultSec(provider)
      if (d === undefined) continue
      for (const nodeType of ["image-to-video", "text-to-video"] as const) {
        const omitted = buildVideoCreditModelIdentifier(provider, undefined, undefined, nodeType)
        const explicit = buildVideoCreditModelIdentifier(provider, d, undefined, nodeType)
        if (omitted !== explicit) offenders.push(`${provider} (${nodeType}): omitted → ${omitted}, ${d}s → ${explicit}`)
      }
    }
    expect(offenders, "add the provider to PRICING_DEFAULT_DURATION_SEC").toEqual([])
  })
})
