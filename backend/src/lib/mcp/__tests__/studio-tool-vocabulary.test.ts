/**
 * The studio production tools speak the PERSON's words.
 *
 * The document calls a scene a "shot" (`shots[]`, `shot_id`, `add_shot`), and
 * the tool and argument NAMES are the document's — they stay, because renaming
 * them would break the wire for a problem that is about language. The prose is
 * another matter: a description is what an agent learns its vocabulary from, and
 * an agent that read "rename a shot" and "frame a shot" on every tool answered
 * a person's question about "shot 2" with scene 2 (incident 2026-09-20). In the
 * editor a film is made of SCENES; a scene has a FRAME (`still`) and a MOTION
 * (`clip`); the SHOTS a person talks about are the `beats[]` inside a motion.
 *
 * Read off the SERVED tools/list — descriptions and every argument's `describe`
 * — so a nineteenth studio tool is held to the rule the day it is registered.
 */
import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { type Scope } from "../../scopes.js"
import { STUDIO_PRODUCTION_TOOL_NAMES } from "../tools/_studio-helpers.js"
import { scenesCalledShots } from "./helpers/studio-vocabulary.js"

vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})
const { buildMcpServer } = await import("../server.js")

const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]

interface ServedTool {
  name: string
  description?: string
  inputSchema?: { properties?: Record<string, { description?: string }> }
}

async function studioTools(): Promise<ServedTool[]> {
  const server = await buildMcpServer({ userId: "u1", scopes: ALL_GRANTED, clientName: "Claude", fastify: Fastify() })
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: ServedTool[] }>> }
  }).server
  const res = await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})
  const family = new Set<string>(STUDIO_PRODUCTION_TOOL_NAMES)
  return res.tools.filter((tool) => family.has(tool.name))
}

/** Everything a model reads about one tool: its description and each argument's. */
function proseOf(tool: ServedTool): string {
  const args = Object.values(tool.inputSchema?.properties ?? {}).map((p) => p.description ?? "")
  return [tool.description ?? "", ...args].join("\n")
}

describe("the studio production tools speak the person's words", () => {
  it("covers the whole family (the list is the family's own)", async () => {
    const tools = await studioTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...STUDIO_PRODUCTION_TOOL_NAMES].sort())
  })

  it("no description or argument calls a scene a shot", async () => {
    const offenders = (await studioTools())
      .map((tool) => ({ tool: tool.name, sentences: scenesCalledShots(proseOf(tool)) }))
      .filter((entry) => entry.sentences.length > 0)
    expect(offenders).toEqual([])
  })

  it("the read says, once, which keys the person's words are", async () => {
    const read = (await studioTools()).find((t) => t.name === "get_studio_production")!
    for (const pair of ["`shots[]`", "`still`", "`clip`", "`beats[]`"]) expect(read.description, pair).toContain(pair)
    for (const word of ["SCENE", "FRAME", "MOTION", "SHOTS"]) expect(read.description, word).toContain(word)
  })

  it("`shot_id` is described as the id of a SCENE wherever it is an argument", async () => {
    for (const tool of await studioTools()) {
      const shotId = tool.inputSchema?.properties?.shot_id?.description
      if (shotId !== undefined) expect(shotId, tool.name).toMatch(/scene/i)
    }
  })

  it("the two generation lanes are named for what the person sees: the scene's frame, the scene's motion", async () => {
    const tools = await studioTools()
    expect(tools.find((t) => t.name === "generate_studio_still")!.description).toMatch(/scene's FRAME/)
    expect(tools.find((t) => t.name === "generate_studio_clip")!.description).toMatch(/scene's MOTION/)
  })

  // "frame" is the scene's `still` to the person; a keyframe is a PLANNED frame.
  it("the keyframe tool says PLANNED frame, so it cannot be read as a scene's frame", async () => {
    const keyframe = (await studioTools()).find((t) => t.name === "generate_studio_keyframe")!
    expect(keyframe.description).toContain("PLANNED frame")
    expect(keyframe.description).toContain("not a scene's frame")
    const bare = (keyframe.description ?? "").replace(/planned frames?|derived frames?|dependent-frame|scene's frame/gi, "")
    expect(bare).not.toMatch(/\bframes?\b/i)
  })

  describe("the guard itself", () => {
    it("catches the ways the mistake is actually made", () => {
      for (const wrong of [
        "Rename a shot, reorder the timeline.",
        "Selected: shot 2.",
        "How many shots it has.",
        // Naming a scene in the same clause is the mistake, not an excuse for it.
        "Append a shot after the last scene.",
        "Reorder the shots so the scene order matches the cut.",
        "Pasted 4 shots after Scene 2.",
        // A sentence that gets it right at the END does not excuse its start.
        "Rename a shot, select a take, set the shots inside a scene's motion.",
      ]) {
        expect(scenesCalledShots(wrong), wrong).not.toEqual([])
      }
    })

    it("accepts the ways a correct clause says what the shot is inside of", () => {
      for (const right of [
        "Set the shots inside the scene's motion.",
        "It has a motion (1 take) and 3 shots inside the motion.",
        "Set the shots with `set_beats`.",
        "A `beats[]` entry is one shot.",
        "Change shot 2 of this scene.",
        "Never call a scene a shot.",
      ]) {
        expect(scenesCalledShots(right), right).toEqual([])
      }
    })

    it("leaves identifiers and other people's words alone", () => {
      expect(scenesCalledShots("Pass `shot_id`; `add_shot` appends; new_studio_shot_from_frame grabs one.")).toEqual([])
      expect(scenesCalledShots('target "new-shot" (the default)')).toEqual([])
      expect(scenesCalledShots('The person says "change shot 2" and means it.')).toEqual([])
      expect(scenesCalledShots('1. "Shot 12 — alley" [s12]')).toEqual([])
      expect(scenesCalledShots("more here than in a one-shot generation")).toEqual([])
    })

    it("an unbalanced quote cannot swallow the prose that follows it", () => {
      const long = `He said "and then nothing closes it. ${"x ".repeat(40)} Rename a shot.`
      expect(scenesCalledShots(long)).not.toEqual([])
    })
  })
})
