/**
 * The per-user project every `/mcp` workflow-mutation tool writes into.
 *
 * The backend resolves it BY NAME (`backend/src/lib/mcp/tools/_mcp-project.ts`
 * — the user's oldest project called "mcp", created on first use), and the
 * dashboard splits the flat workflow list on the same rule, so the two must
 * stay in step: a workflow whose project carries this name is an MCP workflow.
 *
 * Deliberately a PROJECT rule, not a "who created it" rule: an in-app copilot
 * session writes into the project it was opened on, and a workspace session
 * into the workspace's landing project — those flows belong where they were
 * made and stay in My Workflows. Conversely a project a user names "mcp" by
 * hand is treated as the MCP bucket, exactly as the backend would treat it.
 */
export const MCP_PROJECT_NAME = "mcp"

export function isMcpProjectName(projectName: string): boolean {
  return projectName === MCP_PROJECT_NAME
}
