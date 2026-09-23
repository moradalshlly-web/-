/**
 * Guard: every `type` the backend writes into `workflow_triggers` must be
 * permitted by the `workflow_triggers_type_check` DB constraint.
 *
 * Why this exists — the sibling guard (`trigger-type-constraint-sync.test.ts`)
 * watches `workflow_executions.trigger_type` and has caught three drifts. This
 * column had no watcher: migration 036 pinned it to ('webhook','schedule'),
 * migration 249 widened only the sibling when the Telegram lane arrived, and
 * for months two lanes (`POST /v1/telegram/triggers`, then the save-time
 * projection of a Telegram Trigger node) wrote 'telegram' into a column that
 * refused it with check_violation (23514). Unit tests mock Supabase, so the
 * CHECK was never exercised; the node said "listening" over a row that did not
 * exist. Migration 438 widened it. This test makes the next lane fail at PR
 * time instead.
 *
 * Three code-side vocabularies are checked, because each is a place a new
 * lane appears: the `SYNCED_TRIGGER_TYPES` array the projection owns, the Zod
 * `type: z.enum([...])` of the trigger-create route, and any string literal
 * assigned to `type:` inside a `.from("workflow_triggers").insert(...)`.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations")
const BACKEND_SRC = join(__dirname, "..")

const CONSTRAINT = "workflow_triggers_type_check"

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

/**
 * The latest migration (by sorted filename) that (re)defines the constraint
 * via `add constraint <name> check (type in (…))` wins. The inline CHECK of
 * migration 036 deliberately does NOT match: a widening migration must exist,
 * and 438 is the first.
 */
function allowedTypesFromMigrations(): { values: Set<string>; file: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const re = new RegExp(
    `add\\s+constraint\\s+${CONSTRAINT}\\s+check\\s*\\(\\s*type\\s+in\\s*\\(([^)]*)\\)`,
    "i",
  )

  let winner: { values: Set<string>; file: string } | undefined
  for (const f of files) {
    const m = readFileSync(join(MIGRATIONS_DIR, f), "utf8").match(re)
    if (!m) continue
    const values = new Set([...m[1].matchAll(/'([a-z0-9_-]+)'/gi)].map((x) => x[1]))
    winner = { values, file: f }
  }
  if (!winner) {
    throw new Error(`No migration defines ${CONSTRAINT} via "add constraint … check (type in (…))".`)
  }
  return winner
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "__tests__") continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...tsFiles(p))
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function rel(file: string): string {
  return file.slice(REPO_ROOT.length + 1)
}

/** Every string literal in an array/enum literal such as `["a", "b"]`. */
function literalsIn(text: string): string[] {
  return [...text.matchAll(/"([a-z][a-z0-9_-]*)"/g)].map((m) => m[1])
}

/**
 * The vocabularies the code writes from, each mapped to where it lives:
 *  1. `SYNCED_TRIGGER_TYPES = [...]` — the row types the projection creates.
 *  2. `type: z.enum([...])` — what `POST /v1/workflow-triggers` accepts.
 *  3. `type: "<lit>"` inside `.from("workflow_triggers") … .insert(` — a lane
 *     that writes its row by hand (the Telegram bot route).
 */
function typesWrittenByCode(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const note = (value: string, file: string) => found.set(value, [...(found.get(value) ?? []), rel(file)])

  for (const file of tsFiles(BACKEND_SRC)) {
    const src = stripComments(readFileSync(file, "utf8"))
    // Only a file that touches the table can write its `type`; `type: z.enum`
    // is a common key elsewhere (suno stems, media kinds) and means nothing here.
    if (!src.includes('"workflow_triggers"')) continue

    const synced = src.match(/SYNCED_TRIGGER_TYPES\s*:[^=]*=\s*\[([^\]]*)\]/)
    if (synced) for (const v of literalsIn(synced[1])) note(v, file)

    for (const m of src.matchAll(/\btype:\s*z\.enum\(\s*\[([^\]]*)\]/g)) {
      for (const v of literalsIn(m[1])) note(v, file)
    }

    for (const m of src.matchAll(/\.from\(\s*"workflow_triggers"\s*\)[\s\S]{0,300}?\.insert\(\s*\{([\s\S]{0,1200}?)\}\s*\)/g)) {
      for (const t of m[1].matchAll(/\btype:\s*"([a-z][a-z0-9_-]*)"/g)) note(t[1], file)
    }
  }
  return found
}

describe("workflow_triggers.type: code ⊆ DB constraint", () => {
  const { values: allowed, file } = allowedTypesFromMigrations()

  it(`derives a non-empty allowed set from the latest constraint migration (${file})`, () => {
    expect(allowed.size).toBeGreaterThan(0)
  })

  it("scans something real (anti-vacuity): the three lanes that exist today are found", () => {
    const used = typesWrittenByCode()
    for (const lane of ["webhook", "schedule", "telegram"]) {
      expect(used.has(lane), `expected to find "${lane}" written somewhere in backend/src`).toBe(true)
    }
  })

  it("every type the backend writes into workflow_triggers is permitted by the constraint", () => {
    const used = typesWrittenByCode()
    const violations = [...used.entries()]
      .filter(([val]) => !allowed.has(val))
      .map(([val, files]) => `  • "${val}" (written in ${[...new Set(files)].join(", ")})`)

    expect(
      violations,
      `These workflow_triggers.type values are written by backend code but are NOT in the ` +
        `${CONSTRAINT} constraint (latest defined in ${file}: {${[...allowed].sort().join(", ")}}). ` +
        `Postgres rejects the INSERT with check_violation (23514) — the trigger node shows ` +
        `"listening" over a row that was never written. Widen the constraint in a new ` +
        `migration:\n${violations.join("\n")}`,
    ).toEqual([])
  })
})
