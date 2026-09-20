import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { en } from "@/lib/i18n/en"
import { SaveRefusedPill } from "../save-refused-pill"

/**
 * A refused save leaves the canvas fully interactive, so the pill is the only
 * thing that keeps saying "nothing here is being kept" after the toast fades.
 */
describe("SaveRefusedPill", () => {
  afterEach(() => {
    cleanup()
    useWorkflowStore.setState({ workflowId: null, saveRefusedFor: null, isReadOnly: false })
  })

  it("renders nothing on a canvas that saves normally", () => {
    useWorkflowStore.setState({ workflowId: "wf-1", saveRefusedFor: null })
    const { container } = render(<SaveRefusedPill />)
    expect(container).toBeEmptyDOMElement()
  })

  it("says the changes are not being saved once this workflow's save was refused", () => {
    useWorkflowStore.setState({ workflowId: "wf-1", saveRefusedFor: "wf-1" })
    render(<SaveRefusedPill />)
    const pill = screen.getByRole("status")
    expect(pill).toHaveTextContent(en["editor.notWritableReason"])
    // The one thing it must never say.
    expect(pill).not.toHaveTextContent(/another device/i)
  })

  it("stays silent for a refusal that belongs to a DIFFERENT workflow", () => {
    useWorkflowStore.setState({ workflowId: "wf-2", saveRefusedFor: "wf-1" })
    const { container } = render(<SaveRefusedPill />)
    expect(container).toBeEmptyDOMElement()
  })

  it("yields to the read-only pill", () => {
    useWorkflowStore.setState({ workflowId: "wf-1", saveRefusedFor: "wf-1", isReadOnly: true })
    const { container } = render(<SaveRefusedPill />)
    expect(container).toBeEmptyDOMElement()
  })

  it("loading a workflow clears a previous refusal", () => {
    useWorkflowStore.setState({ workflowId: "wf-1", saveRefusedFor: "wf-1" })
    useWorkflowStore.getState().loadWorkflow("wf-1", "Reloaded", [], [])
    expect(useWorkflowStore.getState().saveRefusedFor).toBeNull()
  })

  // Why a refusal is its own state and not `isReadOnly`: it lands mid-run,
  // and the job that is already running (and paid for) still has to paint.
  it("leaves the canvas live — a result still reaches its node, which read-only would drop", () => {
    const node = { id: "n1", type: "instagram-scrape", position: { x: 0, y: 0 }, data: { label: "Instagram" } }
    const store = useWorkflowStore.getState()
    store.loadWorkflow("wf-1", "Scrape", [node as never], [])

    useWorkflowStore.setState({ saveRefusedFor: "wf-1" })
    useWorkflowStore.getState().updateNodeData("n1", { generatedJson: [{ post: 1 }] })
    const painted = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")?.data as Record<string, unknown>
    expect(painted.generatedJson).toEqual([{ post: 1 }])

    // The contrast this design exists for.
    useWorkflowStore.setState({ isReadOnly: true })
    useWorkflowStore.getState().updateNodeData("n1", { generatedJson: [{ post: 2 }] })
    const frozen = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")?.data as Record<string, unknown>
    expect(frozen.generatedJson).toEqual([{ post: 1 }])
  })

  it("is mounted by the canvas", () => {
    const source = readFileSync(join(__dirname, "..", "workflow-canvas.tsx"), "utf8")
    expect(source).toMatch(/<SaveRefusedPill\s*\/>/)
  })
})
