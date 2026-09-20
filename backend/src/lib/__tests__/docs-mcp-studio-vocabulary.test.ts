/**
 * The public MCP docs for the studio family speak the PERSON's words.
 *
 * `docs/mcp/` is what an agent developer reads to learn how to talk to a user
 * about a production, and the user only ever sees the editor: a film made of
 * SCENES, each with a FRAME and a MOTION, and SHOTS inside a motion. The
 * document's word for a scene is "shot" (`shots[]`, `shot_id`, `add_shot`) — an
 * identifier, exact on these pages, and never a word of their prose. The served
 * tool descriptions are held to the same rule by
 * `lib/mcp/__tests__/studio-tool-vocabulary.test.ts`; this keeps the two pages
 * that mirror them from drifting back (incident 2026-09-20).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { STUDIO_PRODUCTION_TOOL_NAMES } from "../mcp/tools/_studio-helpers.js"
import { scenesCalledShots } from "../mcp/__tests__/helpers/studio-vocabulary.js"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8").replace(/\r\n/g, "\n")

/** Markdown wraps a sentence across lines; a paragraph is the unit a reader sees. */
function paragraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => (block.trimStart().startsWith("|") ? block : block.replace(/\n\s*/g, " ")))
}

describe("docs/mcp/studio-productions.md", () => {
  const doc = read("docs/mcp/studio-productions.md")

  it("states the two vocabularies, with every one of the person's words mapped to its key", () => {
    expect(doc).toContain("## Two vocabularies")
    for (const pair of ["`shots[]`", "`still`", "`clip`", "`beats[]`", "`set_beats`"]) expect(doc, pair).toContain(pair)
    expect(doc).toMatch(/never call a scene a\s+shot/i)
  })

  it("never calls a scene a shot in its own prose", () => {
    const offenders = paragraphs(doc).flatMap((block) => scenesCalledShots(block))
    expect(offenders).toEqual([])
  })
})

describe("docs/mcp/tools.md — the studio family's rows", () => {
  const rows = read("docs/mcp/tools.md")
    .split("\n")
    .filter((line) => STUDIO_PRODUCTION_TOOL_NAMES.some((name) => line.startsWith(`| \`${name}\` |`)))

  it("has a row for every tool of the family", () => {
    expect(rows).toHaveLength(STUDIO_PRODUCTION_TOOL_NAMES.length)
  })

  it("never calls a scene a shot", () => {
    const offenders = rows
      .map((row) => ({ row: row.slice(0, 40), sentences: scenesCalledShots(row) }))
      .filter((entry) => entry.sentences.length > 0)
    expect(offenders).toEqual([])
  })
})
