/**
 * The publish / share / save gate for stored credentials (plan D3).
 *
 * A PLAIN credential (no destination) is fine while only the owner can run the
 * workflow. The moment strangers can — publish as an app, share for run — every
 * Webhook Output that references one has to be locked to its address first,
 * and a credential that is missing (deleted, or not the owner's) would fail
 * every run, so it is refused at the same door. The route answers 409
 * `credential_unbound` with the uses, so the client can offer the one-click
 * "Lock to <node URL>" (a PATCH on the credential) and retry.
 *
 * The gate is UX; the runtime check in `resolveHttpAuthHeaders` is the
 * invariant. Presentation runs the LIVE graph, so an already-shared workflow
 * is re-checked at SAVE too (`exposureOf` + the save route).
 */

import type { FastifyReply } from "fastify"
import { supabase } from "./supabase.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "../services/workflow-engine/types.js"
import {
  credentialedWebhookNodes,
  findUnboundCredentialUses,
  type GraphEdgeLike,
  type UnboundCredentialUse,
} from "./http-credentials.js"

interface GraphNodeLike {
  readonly id: string
  readonly type?: string
  readonly data?: Record<string, unknown>
}

export interface GraphLike {
  readonly nodes: ReadonlyArray<GraphNodeLike>
  readonly edges: ReadonlyArray<GraphEdgeLike>
}

export const CREDENTIAL_UNBOUND_MESSAGE =
  "People you don't know will run this workflow, so every stored credential it sends with must be locked to the address you chose. Lock the credential in Integrations (or pick a locked one in the node) and try again."

/** The 409 body: code + message + the uses, each with the node URL the lock can bind to. */
export function sendCredentialUnbound(reply: FastifyReply, uses: ReadonlyArray<UnboundCredentialUse>): FastifyReply {
  return reply.status(409).send({
    error: { code: "credential_unbound", message: CREDENTIAL_UNBOUND_MESSAGE, details: uses },
  })
}

/**
 * Does this graph need the gate at all? A credentialed webhook, or a
 * sub-workflow that may hold one. The ONE pre-filter every lane runs
 * (publish, share, both save branches), so the cheap "no" is the same
 * everywhere and a sub-workflow is never skipped on one of them.
 */
export function graphNeedsCredentialGate(nodes: ReadonlyArray<GraphNodeLike> | null | undefined): boolean {
  return (nodes ?? []).some((n) => n.type === "sub-workflow") || credentialedWebhookNodes(nodes).length > 0
}

/**
 * The graph plus every sub-workflow it reaches (the OWNER's own, like the
 * executor loads them), so a credentialed webhook inside a child is judged at
 * the same door as one on the parent. Each child is read once; depth-capped
 * at the executor's own limit. Conservative on purpose: every child node is
 * walked, including ones on a route the executor would not select.
 */
export async function graphWithSubWorkflows(
  nodes: ReadonlyArray<GraphNodeLike> | null | undefined,
  edges: ReadonlyArray<GraphEdgeLike> | null | undefined,
  ownerId: string,
): Promise<GraphLike> {
  const outNodes: GraphNodeLike[] = []
  const outEdges: GraphEdgeLike[] = [...(edges ?? [])]
  const seen = new Set<string>()
  // Node ids are unique per WORKFLOW, not across them (a duplicated workflow
  // used as a child reuses its ids), so a child's nodes and edges are renamed
  // into their own namespace before they join the parent's — otherwise a
  // child's `field-url` edge could mark a same-id parent node as mapped and
  // hide a real mismatch.
  const scoped = (workflowId: string, id: unknown): unknown => (typeof id === "string" ? `${workflowId}:${id}` : id)
  const walk = async (list: ReadonlyArray<GraphNodeLike> | null | undefined, depth: number): Promise<void> => {
    for (const node of list ?? []) {
      outNodes.push(node)
      if (node.type !== "sub-workflow" || depth >= MAX_SUB_WORKFLOW_DEPTH) continue
      const childId = typeof node.data?.workflowId === "string" ? node.data.workflowId : ""
      if (!childId || seen.has(childId)) continue
      seen.add(childId)
      const { data } = await supabase
        .from("workflows")
        .select("nodes, edges")
        .eq("id", childId)
        .eq("user_id", ownerId)
        .maybeSingle()
      if (!data || !Array.isArray(data.nodes)) continue
      if (Array.isArray(data.edges)) {
        for (const edge of data.edges as GraphEdgeLike[]) {
          outEdges.push({ ...edge, source: scoped(childId, edge.source), target: scoped(childId, edge.target) })
        }
      }
      await walk((data.nodes as GraphNodeLike[]).map((n) => ({ ...n, id: `${childId}:${n.id}` })), depth + 1)
    }
  }
  await walk(nodes, 0)
  return { nodes: outNodes, edges: outEdges }
}

/**
 * Empty = the graph may go in front of strangers as far as credentials go.
 * Runs the cheap pre-filter first, so a graph with neither a credentialed
 * webhook nor a sub-workflow costs nothing. Edges are what tell a mapped URL
 * apart from a static one.
 */
export async function unboundCredentialUsesFor(
  nodes: ReadonlyArray<GraphNodeLike> | null | undefined,
  ownerId: string,
  edges?: ReadonlyArray<GraphEdgeLike> | null,
): Promise<UnboundCredentialUse[]> {
  if (!graphNeedsCredentialGate(nodes)) return []
  const graph: GraphLike = (nodes ?? []).some((n) => n.type === "sub-workflow")
    ? await graphWithSubWorkflows(nodes, edges, ownerId)
    : { nodes: nodes ?? [], edges: edges ?? [] }
  if (credentialedWebhookNodes(graph.nodes).length === 0) return []
  return findUnboundCredentialUses(graph.nodes, ownerId, graph.edges)
}

/**
 * Is this workflow already reachable by people other than its owner — shared
 * for run, or the source of an active published app? Asked only when a save
 * carries a credentialed webhook node (the pre-filter above), so the two reads
 * stay off the hot autosave path.
 */
export async function workflowIsExposed(
  workflowId: string,
  row: { share_token?: unknown; is_presentation_enabled?: unknown; visibility?: unknown } | null | undefined,
): Promise<boolean> {
  if (row && row.is_presentation_enabled === true && typeof row.share_token === "string" && row.share_token) return true
  // A workspace-visible workflow can be run by members with an editor grant
  // (once organisations are on); it counts as exposed today so a plain
  // credential is refused at save rather than at 3 a.m.
  if (row && typeof row.visibility === "string" && row.visibility !== "private") return true
  const { count } = await supabase
    .from("published_apps")
    .select("id", { count: "exact", head: true })
    .eq("workflow_id", workflowId)
    .eq("is_active", true)
    .is("deleted_at", null)
  return (count ?? 0) > 0
}
