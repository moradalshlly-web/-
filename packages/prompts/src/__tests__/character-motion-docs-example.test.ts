/**
 * Public Docs Maintenance Rule: worked examples in docs MUST match the code.
 * The Character Motion page quotes the composer's exact output for one sequence
 * in both hint modes; this reads the page and fails if either quote drifts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { composeCharacterMotionHintFromConnections as compose } from "../character-motion.js"

const DOC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/nodes/parameters/character-motion.md"),
  "utf8",
)
const IDS = ["walk-in-from-left", "wave-hello", "hug-partner"]
const TIMING = { position: "start", pace: "slow" } as const

describe("docs/nodes/parameters/character-motion.md worked example", () => {
  it("quotes the full-mode output verbatim", () => {
    expect(DOC).toContain(compose(IDS, ["Mira"], ["Theo"], TIMING))
  })
  it("quotes the compact-mode output verbatim", () => {
    expect(DOC).toContain(compose(IDS, ["Mira"], ["Theo"], TIMING, "compact"))
  })
})
