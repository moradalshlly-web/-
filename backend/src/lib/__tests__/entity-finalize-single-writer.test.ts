/**
 * THE invariant behind the entity reconcile-recovery fix.
 *
 * "A recovered provider result completes the entity job exactly as the worker
 * would have" is only true while there is ONE completion tail. The moment
 * `workers/handlers/entity.ts` writes its own `markJobCompleted` /
 * `commitJobCredits` / `setCharacterPortrait` again, the worker and the cron
 * are two implementations of the same contract and they will drift — silently,
 * because the drift only shows up on a job whose worker died.
 *
 * So: entity.ts may complete a job only through `finalizeEntityJob`.
 * `generate-script` is the one handler in that file that is NOT a media job
 * (LLM lane, no provider task id, nothing to recover) and keeps its own
 * completion — it is allowlisted here by name, and nothing else is.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ENTITY = join(__dirname, "..", "..", "workers", "handlers", "entity.ts")

/** Strip comments so a `markJobCompleted` mentioned in prose is not a hit. */
function code(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

/** Line numbers of every call to `name(` in entity.ts's real code. */
function callSites(src: string, name: string): number[] {
  const out: number[] = []
  for (const m of src.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))) {
    out.push(src.slice(0, m.index).split("\n").length)
  }
  return out
}

/** The `handleGenerateScript` body — the one allowlisted completion writer. */
function scriptHandlerRange(src: string): [number, number] {
  const start = src.indexOf("const handleGenerateScript")
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf("\nconst handleGenerate", start + 10)
  const line = (i: number) => src.slice(0, i).split("\n").length
  return [line(start), end === -1 ? Number.MAX_SAFE_INTEGER : line(end)]
}

describe("entity handlers have exactly one completion tail", () => {
  const src = code(readFileSync(ENTITY, "utf8"))
  const [scriptStart, scriptEnd] = scriptHandlerRange(src)
  const outsideScript = (lines: number[]) =>
    lines.filter((l) => l < scriptStart || l > scriptEnd)

  it("routes every media completion through finalizeEntityJob", () => {
    expect(callSites(src, "finalizeEntityJob").length).toBeGreaterThanOrEqual(5)
  })

  for (const fn of ["markJobCompleted", "commitJobCredits"]) {
    it(`never calls ${fn} directly outside handleGenerateScript`, () => {
      // A hit here means a handler grew its own completion again. Move it into
      // lib/entity-finalize.ts so the reconcile recovery keeps running the same
      // code — do not add it to this guard.
      expect(outsideScript(callSites(src, fn))).toEqual([])
    })
  }

  for (const fn of [
    "setCharacterPortrait", "attachAssetToCharacter", "autoAttachLocationAsset",
    "autoAttachObjectAsset", "setObjectMainImage",
    "autoAttachCreatureAsset", "setCreatureMainImage",
  ]) {
    it(`never writes the studio row directly (${fn})`, () => {
      // The attach fan-out is the half generic finalize could never do, and the
      // half a second copy would silently skip on the recovery path.
      expect(callSites(src, fn)).toEqual([])
    })
  }
})
