import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The BurnCaptions composition must render per-segment captions when the plan
// carries `segments`, each gated to its own time range (so an overlay's own
// enter/exit animation can't bleed past the segment boundary), and fall back to
// the single top-level overlay otherwise. Guarded as source text (the overlays
// use Remotion hooks that the rest of the suite does not mount) so the wiring
// can't silently regress to always rendering the top-level style.
describe("burn-captions composition wires per-segment captions", () => {
  const src = readFileSync(join(__dirname, "..", "burn-captions.tsx"), "utf8")

  it("branches on plan.segments and maps each to an overlay", () => {
    expect(src).toContain("plan.segments")
    expect(src).toContain("SegmentOverlay")
  })

  it("time-gates each segment to [startMs, endMs)", () => {
    expect(src).toMatch(/ms < segment\.startMs \|\| ms >= segment\.endMs/)
  })

  it("keeps the single-overlay path for the no-segments case", () => {
    expect(src).toContain("captions={plan.captions}")
  })
})
