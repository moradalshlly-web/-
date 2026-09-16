/**
 * The button's whole job is the chain: pick a file → land it in the default
 * project → open it. Each link is tested through the real component, because
 * the failures that matter are the ones where a link is silently skipped — a
 * bad file that still creates a project, or a successful import that leaves the
 * user looking at the dashboard wondering whether anything happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  importWorkflow: vi.fn(),
  resolveDefaultProjectId: vi.fn(),
  getUser: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("react-router-dom", () => ({ useNavigate: () => h.navigate }))
vi.mock("@/lib/api", () => ({ importWorkflow: h.importWorkflow }))
vi.mock("@/lib/default-project", () => ({ resolveDefaultProjectId: h.resolveDefaultProjectId }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: h.getUser } }) }))
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: h.warning } }))
vi.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: vi.fn() } }))

import { ImportJsonButton } from "../import-json-button"

const WORKFLOW = {
  name: "My Flow",
  nodes: [{ id: "a", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  exportedAt: "2026-01-01T00:00:00.000Z",
  version: "1.0",
}

function file(contents: unknown, name = "flow.json") {
  return new File([typeof contents === "string" ? contents : JSON.stringify(contents)], name, {
    type: "application/json",
  })
}

async function pick(contents: unknown) {
  const user = userEvent.setup()
  const { container } = render(<ImportJsonButton />)
  const input = container.querySelector("input[type=file]") as HTMLInputElement
  await user.upload(input, file(contents))
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  h.resolveDefaultProjectId.mockResolvedValue({ projectId: "p1" })
  h.importWorkflow.mockResolvedValue({ id: "w1", projectId: "p1" })
})

describe("ImportJsonButton", () => {
  it("opens the imported workflow, which is the point of the button", async () => {
    await pick(WORKFLOW)
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/projects/p1/workflows/w1"))
    expect(h.success).toHaveBeenCalled()
  })

  it("sends the parsed bundle to the caller's default project", async () => {
    await pick(WORKFLOW)
    await waitFor(() => expect(h.importWorkflow).toHaveBeenCalled())
    const sent = h.importWorkflow.mock.calls[0][0]
    expect(sent.projectId).toBe("p1")
    expect(sent.name).toBe("My Flow (Imported)")
    expect(sent.version).toBe(1)
  })

  it("accepts a tutorial seed file, the same as the editor's import does", async () => {
    await pick({ meta: { slug: "intro" }, workflow: WORKFLOW })
    await waitFor(() => expect(h.importWorkflow).toHaveBeenCalled())
  })

  it("refuses a file that is not a workflow WITHOUT creating anything", async () => {
    await pick({ hello: "world" })
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    // The parse happens first on purpose: a stray JSON file must not lazy-create
    // somebody's default project on its way to being rejected.
    expect(h.resolveDefaultProjectId).not.toHaveBeenCalled()
    expect(h.importWorkflow).not.toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("stays on the dashboard when the import itself fails", async () => {
    h.importWorkflow.mockRejectedValue(new Error("quota exceeded"))
    await pick(WORKFLOW)
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it("comes back enabled after a failure, so the user can pick another file", async () => {
    h.importWorkflow.mockRejectedValue(new Error("nope"))
    await pick(WORKFLOW)
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled())
  })

  it("clears the input so re-picking the SAME file after a failure still fires", async () => {
    h.importWorkflow.mockRejectedValue(new Error("nope"))
    const input = await pick(WORKFLOW)
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    expect(input.value).toBe("")
  })

  it("warns about media this instance cannot fetch, rather than letting it fail at run time", async () => {
    h.importWorkflow.mockResolvedValue({
      id: "w1",
      projectId: "p1",
      importReport: { rehosted: 0, unreachable: [{ nodeId: "n1", nodeLabel: "Intro" }], skipped: [] },
    })
    await pick(WORKFLOW)
    await waitFor(() => expect(h.warning).toHaveBeenCalled())
    expect(String(h.warning.mock.calls[0][0])).toContain("Intro")
  })

  it("asks a signed-out visitor to sign in instead of failing obscurely", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } })
    await pick(WORKFLOW)
    await waitFor(() => expect(h.error).toHaveBeenCalled())
    expect(h.importWorkflow).not.toHaveBeenCalled()
  })
})
