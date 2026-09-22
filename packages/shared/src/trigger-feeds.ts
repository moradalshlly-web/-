/**
 * Every way one node FEEDS another — the ONE definition the server's run
 * scope (`triggerRunScope`) and the editor's "is this trigger wired?" read
 * from, so the card can never say "the branch" while the server runs the
 * whole workflow, or the other way round:
 *
 * - a drawn edge whose two ends are both on the graph (a delta that deleted a
 *   node leaves its edges behind; those feed nothing);
 * - Group membership: a node inside a Group feeds the group (`parentId`),
 *   the way the engine orders a group after its members;
 * - a field mapping: `data.fieldMappings[field].sourceNodeId` feeds the node
 *   that carries the mapping, even after the edge it was made from is gone.
 */

export interface FeedNode {
  readonly id: string
  readonly parentId?: string | null
  readonly data?: unknown
}

export interface FeedEdge {
  readonly source: string
  readonly target: string
}

export interface FeedMaps {
  /** node id → the ids it feeds */
  readonly children: ReadonlyMap<string, ReadonlyArray<string>>
  /** node id → the ids that feed it */
  readonly parents: ReadonlyMap<string, ReadonlyArray<string>>
}

export function buildFeedMaps(nodes: ReadonlyArray<FeedNode>, edges: ReadonlyArray<FeedEdge>): FeedMaps {
  const live = new Set(nodes.map((n) => n.id))
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  const feeds = (source: string, target: string) => {
    if (!live.has(source) || !live.has(target) || source === target) return
    children.set(source, [...(children.get(source) ?? []), target])
    parents.set(target, [...(parents.get(target) ?? []), source])
  }
  for (const edge of edges) feeds(edge.source, edge.target)
  for (const n of nodes) {
    if (typeof n.parentId === "string" && n.parentId) feeds(n.id, n.parentId)
    const mappings = (n.data as { fieldMappings?: unknown } | null | undefined)?.fieldMappings
    if (mappings && typeof mappings === "object") {
      for (const mapping of Object.values(mappings as Record<string, unknown>)) {
        const sourceNodeId = (mapping as { sourceNodeId?: unknown } | null)?.sourceNodeId
        if (typeof sourceNodeId === "string" && sourceNodeId) feeds(sourceNodeId, n.id)
      }
    }
  }
  return { children, parents }
}

/** Does this node feed anything? A trigger that does not runs the whole workflow. */
export function nodeFeedsAnything(nodes: ReadonlyArray<FeedNode>, edges: ReadonlyArray<FeedEdge>, nodeId: string): boolean {
  return (buildFeedMaps(nodes, edges).children.get(nodeId) ?? []).length > 0
}
