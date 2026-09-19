/** Workflow execution statuses that indicate an active (non-terminal) execution. */
export const ACTIVE_EXECUTION_STATUSES = ["pending", "running", "stopping"] as const

/** Node's `IncomingHttpHeaders` types header values as `string | string[] | undefined`. Take the first. */
export function firstHeaderValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Extracts an optional workflowId from the raw request body.
 * The field is NOT part of any Zod schema — it's injected by the frontend
 * so standalone (single-node) jobs can be associated with a workflow for
 * display in the execution history.
 */
export function extractWorkflowId(body: unknown): string | null {
  if (body && typeof body === "object" && "workflowId" in body) {
    const val = (body as Record<string, unknown>).workflowId
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}

/**
 * Extracts an optional nodeId from the raw request body. Like workflowId, this
 * is NOT part of any Zod schema — the frontend injects it (via withWorkflowId)
 * so a single-node job can be tied back to its canvas node and its in-flight
 * progress restored after a page reload. Persisted to the dedicated
 * `jobs.node_id` column.
 */
export function extractNodeId(body: unknown): string | null {
  if (body && typeof body === "object" && "nodeId" in body) {
    const val = (body as Record<string, unknown>).nodeId
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}

/**
 * Did the caller ask for the job id up front instead of a held response?
 *
 * A scrape runs for minutes — a 20-page site crawl measured 252 s — and the
 * edge in front of the API cuts a request at ~100 s. Held open, the browser
 * got a 524 while the job finished server-side and was charged, so the editor
 * showed "failed" for a run that succeeded. A caller that can poll sends
 * `respondAsync: true`; the route answers `{ jobId, status: "pending" }` and
 * finishes as detached work.
 *
 * Read off the RAW body, like `workflowId` / `nodeId`: it is a transport
 * preference, not part of the scrape's input, so it stays out of every Zod
 * schema (and out of `input_data`). Strictly `true`.
 *
 * Opt-in, and it has to be. Held open, these routes answer with the result in
 * the body, and two kinds of caller depend on exactly that: every community
 * install already in the field relays a scrape through `callCloudRoute` and
 * reads `json` straight off the response, and so does any direct API caller.
 * Answering all of them with a bare job id would hand each one an empty scrape
 * it still paid for. Callers that can poll say so; the rest keep what they had.
 */
export function wantsJobIdFirst(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as Record<string, unknown>).respondAsync === true
}

/**
 * Extracts an optional forcePrivate flag from the raw request body.
 * Like workflowId, this is NOT part of Zod schemas — it's injected by the
 * frontend/orchestrator when the node uses uploaded/private input content.
 */
export function extractForcePrivate(body: unknown): boolean {
  if (body && typeof body === "object" && "forcePrivate" in body) {
    return (body as Record<string, unknown>).forcePrivate === true
  }
  return false
}

/**
 * Extracts a provider string from the raw request body before Zod parsing.
 * Used in creditGuard preHandlers where the parsed body isn't yet available.
 */
export function extractProvider(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "provider" in body) {
    const val = (body as Record<string, unknown>).provider
    if (typeof val === "string" && val.length > 0) return val
  }
  return fallback
}
