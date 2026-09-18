/**
 * Structural validation for the podcast editing templates (PR #12).
 *
 * A seeded template that does not load is worse than none: the workflow it seeds
 * must reference REAL node types and REAL handles, or a clone opens broken. The
 * POST/PATCH /v1/workflows route validates loosely (a node-type denylist + a
 * handle migration), so the real guard for a shipped template's wiring is here.
 *
 * For every node in each template this asserts the type is registered in
 * NODE_HANDLES (the generated handle registry — the same source /v1/nodes and
 * gen:skills read), and every edge's `source`/`target` id exists and its
 * `sourceHandle`/`targetHandle` is a real handle on that node. The `list` node
 * is special-cased: its handles are dynamic per column (`col_<id>` out,
 * `col_<id>_in` in), derived from `data.columns[]`, not the static NODE_HANDLES
 * entry (which only carries the bare `in`).
 */
import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { TEMPLATE_CATEGORIES, isKineticCaptionStyle } from "@nodaro/shared"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "..", "templates")

const SLUGS = ["podcast-tighten-episode", "podcast-clip-pack"] as const

async function loadTemplate(slug: string): Promise<TutorialTemplateDoc> {
  return JSON.parse(await readFile(join(TEMPLATES_DIR, `${slug}.json`), "utf8")) as TutorialTemplateDoc
}

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

/** The valid input/output handle ids for a node, resolving the `list` node's
 *  dynamic per-column handles from its stored columns. */
function handlesFor(node: Node): { inputs: Set<string>; outputs: Set<string> } {
  const spec = NODE_HANDLES[node.type]
  const inputs = new Set<string>(spec?.inputs ?? [])
  const outputs = new Set<string>(spec?.outputs ?? [])
  if (node.type === "list") {
    const columns = (node.data?.columns ?? []) as Array<{ handleId?: string }>
    for (const col of columns) {
      if (typeof col.handleId === "string" && col.handleId) {
        outputs.add(col.handleId)
        inputs.add(`${col.handleId}_in`)
      }
    }
  }
  return { inputs, outputs }
}

describe("podcast editing templates — structural validity", () => {
  for (const slug of SLUGS) {
    describe(slug, () => {
      it("declares the required marketplace card metadata", async () => {
        const t = await loadTemplate(slug)
        expect(t.slug).toBe(slug)
        expect(t.name.length).toBeGreaterThan(0)
        expect(TEMPLATE_CATEGORIES).toContain(t.category)
        expect(t.outputTypes).toEqual(["video"])
        expect(t.listedIn).toEqual(["marketplace"])
        expect(typeof t.tutorialCategorySlug).toBe("string")
        expect(typeof t.tutorialSortOrder).toBe("number")
        expect(Array.isArray(t.nodes)).toBe(true)
        expect(Array.isArray(t.edges)).toBe(true)
        expect((t.nodes as Node[]).length).toBeGreaterThan(0)
      })

      it("uses only registered node types", async () => {
        const t = await loadTemplate(slug)
        for (const node of t.nodes as Node[]) {
          expect(node.id, `node ${JSON.stringify(node.id)} has an id`).toBeTruthy()
          expect(
            NODE_HANDLES[node.type],
            `node type "${node.type}" (node ${node.id}) is registered in NODE_HANDLES`,
          ).toBeDefined()
        }
      })

      it("wires every edge to a real handle on a real node", async () => {
        const t = await loadTemplate(slug)
        const byId = new Map((t.nodes as Node[]).map((n) => [n.id, n]))
        for (const edge of t.edges as Edge[]) {
          const src = byId.get(edge.source)
          const tgt = byId.get(edge.target)
          expect(src, `edge ${edge.id} source node "${edge.source}" exists`).toBeDefined()
          expect(tgt, `edge ${edge.id} target node "${edge.target}" exists`).toBeDefined()

          const srcHandles = handlesFor(src!)
          const tgtHandles = handlesFor(tgt!)
          expect(
            typeof edge.sourceHandle === "string" && srcHandles.outputs.has(edge.sourceHandle),
            `edge ${edge.id}: "${edge.sourceHandle}" is a real OUTPUT of ${src!.type} (${edge.source}) — has [${[...srcHandles.outputs].join(", ")}]`,
          ).toBe(true)
          expect(
            typeof edge.targetHandle === "string" && tgtHandles.inputs.has(edge.targetHandle),
            `edge ${edge.id}: "${edge.targetHandle}" is a real INPUT of ${tgt!.type} (${edge.target}) — has [${[...tgtHandles.inputs].join(", ")}]`,
          ).toBe(true)
        }
      })
    })
  }

  it("Tighten Episode captions from the remapped transcript (apply-edl json), not the raw one", async () => {
    const t = await loadTemplate("podcast-tighten-episode")
    const nodes = t.nodes as Node[]
    const captions = nodes.find((n) => n.type === "add-captions")!
    const applyEdl = nodes.find((n) => n.type === "apply-edl")!
    expect(captions).toBeDefined()
    const transcriptEdge = (t.edges as Edge[]).find(
      (e) => e.target === captions.id && e.targetHandle === "transcript",
    )
    expect(transcriptEdge, "add-captions has a transcript edge").toBeDefined()
    expect(transcriptEdge!.source).toBe(applyEdl.id)
    expect(transcriptEdge!.sourceHandle).toBe("json")
    // A wired transcript requires a KINETIC caption style (payload-builder throws
    // otherwise, since a non-kinetic subtitle style ignores the transcript).
    const capStyle = (captions.data as { style?: string }).style
    expect(isKineticCaptionStyle(capStyle), `add-captions style "${capStyle}" is kinetic`).toBe(true)
    // edit-plan is in tighten mode with no fan-out list.
    expect((nodes.find((n) => n.type === "edit-plan")!.data as { mode?: string }).mode).toBe("tighten")
    expect(nodes.some((n) => n.type === "list")).toBe(false)
  })

  it("Clip Pack fans out edit-plan directly into per-clip render + self-transcribed word-level captions", async () => {
    const t = await loadTemplate("podcast-clip-pack")
    const nodes = t.nodes as Node[]
    const edges = t.edges as Edge[]

    const plan = nodes.find((n) => n.type === "edit-plan")!
    expect((plan.data as { mode?: string }).mode).toBe("clips")

    // The current engine's fan-out carrier (listResults) is primary-only, so the
    // fan-out is a DIRECT edit-plan → apply-edl edge (edit-plan ∈ FAN_OUT_EACH_TYPES),
    // not a `list` staging node, and there is no fan-in `collect` (it can't gather
    // a member's fan-out results). Both deferred to later engine work.
    expect(nodes.some((n) => n.type === "list"), "no list staging node").toBe(false)
    expect(nodes.some((n) => n.type === "collect"), "no collect fan-in node").toBe(false)

    // edit-plan:edl → apply-edl:edl (fans out one render per clip)
    const applyEdl = nodes.find((n) => n.type === "apply-edl")!
    const planToApply = edges.find((e) => e.source === plan.id && e.target === applyEdl.id)
    expect(planToApply, "edit-plan → apply-edl edge exists").toBeDefined()
    expect(planToApply!.sourceHandle).toBe("edl")
    expect(planToApply!.targetHandle).toBe("edl")

    // apply-edl:media → add-captions:in with outputMode "each" (fan out per clip)
    const captions = nodes.find((n) => n.type === "add-captions")!
    const applyToCaptions = edges.find((e) => e.source === applyEdl.id && e.target === captions.id)
    expect(applyToCaptions, "apply-edl → add-captions edge exists").toBeDefined()
    expect(applyToCaptions!.sourceHandle).toBe("media")
    expect(applyToCaptions!.targetHandle).toBe("in")
    expect((applyToCaptions!.data as { outputMode?: string } | undefined)?.outputMode).toBe("each")

    // word-level karaoke captions, self-sourced per clip (autoTranscribe) — no
    // wired transcript edge (the per-clip remap pairing is deferred engine work).
    expect((captions.data as { wordLevel?: boolean }).wordLevel).toBe(true)
    expect(isKineticCaptionStyle((captions.data as { style?: string }).style)).toBe(true)
    expect((captions.data as { autoTranscribe?: boolean }).autoTranscribe).toBe(true)
    const capTranscript = edges.find((e) => e.target === captions.id && e.targetHandle === "transcript")
    expect(capTranscript, "add-captions has NO wired transcript edge").toBeUndefined()
  })
})
