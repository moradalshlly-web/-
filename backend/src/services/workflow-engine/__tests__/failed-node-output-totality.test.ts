/**
 * FAILED-NODE-OUTPUT TOTALITY.
 *
 * A run can refuse its result and still RETAIN what it produced — the 3D-scene
 * authoring lanes publish a real, billed revision and then fail the job on the
 * visual reviewer's verdict. `NodeExecutionState.output` is how that reaches a
 * client, and the hazard is structural rather than clever: every emitter of a
 * FAILED node state builds a FRESH object (`{ status, nodeType, error, … }`),
 * so a field nobody listed is simply gone. That is exactly how the draft was
 * dropped for a year: `output` was an unstated convention of the COMPLETED
 * path, and the failure path had never been asked the question.
 *
 * The funnel is `failed-node-output.ts` — `retainedOutputOfFailedJob` (from a
 * `jobs` row) and `retainedOutputOfRejection` (from the Error a node threw).
 * This guard is FILE-KEYED, like `job-policy-result-totality.test.ts`: a file
 * that writes a failed node state and imports NEITHER reader fails the build.
 *
 * That coarseness is deliberate and its limit is worth stating: it does NOT
 * catch a second failed-state write added inside a file already importing the
 * module. What it does catch is the case that actually happened — a NEW lane
 * (a crash-recovery reconcile, a future resume path) writing `status: "failed"`
 * from scratch, unaware the field exists.
 *
 * The allowlist is the point, not an escape hatch: each entry says WHY the file
 * is not a node-state emitter, and a stale entry fails too, so a file that
 * starts emitting one cannot inherit a permanent hole.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")

/** The funnel itself. */
const FUNNEL = "services/workflow-engine/failed-node-output.ts"

/**
 * Files that mention `NodeExecutionState` and write `status: "failed"` — but
 * onto a ROW (`workflow_executions` / `jobs`), never onto a node state. A row's
 * failure is the execution's own terminal status; it carries no per-node
 * output and never could.
 */
const NOT_A_NODE_STATE: ReadonlyMap<string, string> = new Map([
  [
    "lib/reconcile/workflow-executions-cron.ts",
    "flips the workflow_executions ROW to failed; its per-node states come from reconcileNodeStatesFromJobs, which is on the funnel",
  ],
])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

/** `status: "failed"` (object literal) or `…status = "failed"` (assignment). */
const FAILED_WRITE = /status:\s*["']failed["']|status\s*=\s*["']failed["']/g

interface Hit {
  file: string
  lines: number[]
  importsFunnel: boolean
}

function failedNodeStateEmitters(): Hit[] {
  const hits: Hit[] = []
  for (const abs of tsFiles(SRC)) {
    const file = abs.slice(SRC.length + 1).split("\\").join("/")
    if (file === FUNNEL) continue
    const raw = readFileSync(abs, "utf8")
    // Only files that traffic in node states at all — the type name is the
    // cheapest honest proxy, and every emitter today declares or imports it.
    if (!raw.includes("NodeExecutionState")) continue
    const src = blankComments(raw)
    const lines: number[] = []
    for (const m of src.matchAll(FAILED_WRITE)) {
      lines.push(src.slice(0, m.index).split("\n").length)
    }
    if (lines.length === 0) continue
    hits.push({
      file,
      lines,
      importsFunnel: /failed-node-output\.js/.test(raw),
    })
  }
  return hits
}

describe("every failed node state can carry what the run retained", () => {
  const hits = failedNodeStateEmitters()

  it("scans the real emitter population", () => {
    expect(hits.length).toBeGreaterThanOrEqual(3)
  })

  it("every failed-node-state writer reads the retained output", () => {
    const violations = hits
      .filter((h) => !h.importsFunnel && !NOT_A_NODE_STATE.has(h.file))
      .map((h) => `  • ${h.file}:${h.lines.join(",")}`)
    expect(
      violations,
      `These write a node state with status:"failed" without reading what the run RETAINED, ` +
        `so a refused-but-published result (a 3D-scene draft, a future equivalent) dies here: ` +
        `billed, addressable by the artifact routes, and invisible to every client.\n\n` +
        `Import from "${FUNNEL}" — retainedOutputOfFailedJob(row.output_data, nodeType) when you ` +
        `hold the jobs row, retainedOutputOfRejection(err) when you hold the thrown Error — and ` +
        `spread the result onto the state. If the file writes a ROW's status rather than a node ` +
        `state's, add it to NOT_A_NODE_STATE *with the reason*.\n\n${violations.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale allowlist entry", () => {
    const stale = [...NOT_A_NODE_STATE.keys()].filter((f) => !hits.some((h) => h.file === f))
    expect(
      stale,
      `On NOT_A_NODE_STATE but no longer writing status:"failed":\n  • ${stale.join("\n  • ")}`,
    ).toEqual([])
  })

  it("names the two live emitters", () => {
    const onFunnel = hits.filter((h) => h.importsFunnel).map((h) => h.file)
    expect(onFunnel).toContain("workers/orchestrator-worker.ts")
    expect(onFunnel).toContain("lib/reconcile/node-states.ts")
  })
})
