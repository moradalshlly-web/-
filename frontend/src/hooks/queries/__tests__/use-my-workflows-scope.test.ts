import { describe, it, expect } from "vitest"
import { filterWorkflowsByScope } from "../use-my-workflows-queries"
import { MCP_PROJECT_NAME } from "@/lib/mcp-project"

/**
 * The "MCP Workflows" tab is a slice of the one native list, split on the
 * project name the backend's `ensureMcpProject` writes ("mcp"). The two tabs
 * must partition the list: nothing shown twice, nothing dropped.
 */
const rows = [
  { id: "a", projectName: "My Recent Flows" },
  { id: "b", projectName: MCP_PROJECT_NAME },
  { id: "c", projectName: "Client work" },
  { id: "d", projectName: MCP_PROJECT_NAME },
]

describe("filterWorkflowsByScope", () => {
  it("'all' returns every row, untouched", () => {
    expect(filterWorkflowsByScope(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c", "d"])
  })

  it("'mcp' keeps only the mcp project's flows", () => {
    expect(filterWorkflowsByScope(rows, "mcp").map((r) => r.id)).toEqual(["b", "d"])
  })

  it("'personal' keeps everything else", () => {
    expect(filterWorkflowsByScope(rows, "personal").map((r) => r.id)).toEqual(["a", "c"])
  })

  it("personal + mcp partition the list (no row in both, none lost)", () => {
    const personal = filterWorkflowsByScope(rows, "personal").map((r) => r.id)
    const mcp = filterWorkflowsByScope(rows, "mcp").map((r) => r.id)
    expect([...personal, ...mcp].sort()).toEqual(rows.map((r) => r.id).sort())
    expect(personal.filter((id) => mcp.includes(id))).toEqual([])
  })

  it("matches the project name exactly — 'MCP' or 'mcp tools' are ordinary projects", () => {
    const odd = [{ id: "x", projectName: "MCP" }, { id: "y", projectName: "mcp tools" }]
    expect(filterWorkflowsByScope(odd, "mcp")).toEqual([])
    expect(filterWorkflowsByScope(odd, "personal").map((r) => r.id)).toEqual(["x", "y"])
  })
})
