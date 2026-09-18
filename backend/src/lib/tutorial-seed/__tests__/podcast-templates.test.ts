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
import { TEMPLATE_CATEGORIES } from "@nodaro/shared"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "..", "templates")

const SLUGS = ["podcast-tighten-episode", "podcast-clip-pack"] as const

async function loadTemplate(slug: string): Promise<TutorialTemplateDoc> {
  return JSON.parse(await readFile(join(TEMPLATES_DIR, `${slug}.json`), "utf8")) as TutorialTemplateDoc
}

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

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
    // edit-plan is in tighten mode with no fan-out list.
    expect((nodes.find((n) => n.type === "edit-plan")!.data as { mode?: string }).mode).toBe("tighten")
    expect(nodes.some((n) => n.type === "list")).toBe(false)
  })

  it("Clip Pack fans out the clips list into per-clip render + word-level captions + collect", async () => {
    const t = await loadTemplate("podcast-clip-pack")
    const nodes = t.nodes as Node[]
    const edges = t.edges as Edge[]

    const plan = nodes.find((n) => n.type === "edit-plan")!
    expect((plan.data as { mode?: string }).mode).toBe("clips")

    // edit-plan → list column (the fan-out staging point)
    const list = nodes.find((n) => n.type === "list")!
    const planToList = edges.find((e) => e.source === plan.id && e.target === list.id)
    expect(planToList, "edit-plan → list edge exists").toBeDefined()
    expect(planToList!.sourceHandle).toBe("edl")
    expect(planToList!.targetHandle).toBe("col_default_in")

    // list column → apply-edl edl (per-clip fan-out)
    const applyEdl = nodes.find((n) => n.type === "apply-edl")!
    const listToApply = edges.find((e) => e.source === list.id && e.target === applyEdl.id)
    expect(listToApply, "list → apply-edl edge exists").toBeDefined()
    expect(listToApply!.sourceHandle).toBe("col_default")
    expect(listToApply!.targetHandle).toBe("edl")

    // word-level (karaoke) captions from the remapped transcript
    const captions = nodes.find((n) => n.type === "add-captions")!
    expect((captions.data as { wordLevel?: boolean }).wordLevel).toBe(true)
    const capTranscript = edges.find((e) => e.target === captions.id && e.targetHandle === "transcript")
    expect(capTranscript!.source).toBe(applyEdl.id)
    expect(capTranscript!.sourceHandle).toBe("json")

    // fan-in: add-captions → collect
    const collect = nodes.find((n) => n.type === "collect")!
    const capToCollect = edges.find((e) => e.source === captions.id && e.target === collect.id)
    expect(capToCollect, "add-captions → collect edge exists").toBeDefined()
    expect(capToCollect!.targetHandle).toBe("in")
  })
})
