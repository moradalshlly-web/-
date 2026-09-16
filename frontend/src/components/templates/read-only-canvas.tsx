import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent, type ReactNode } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react"
import { nodeTypes } from "@/components/nodes"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { migrateSnapshot } from "@/components/tutorials/migrate-snapshot"
import { useRevealDecision } from "@/components/tutorials/use-reveal-decision"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { NodeInspector } from "./node-inspector"
import { nodeAtPoint, type InspectorNode, type NodeRect } from "./node-inspector-fields"
import "@xyflow/react/dist/style.css"

/**
 * The nodes are `pointer-events: none` (globals.css) so the pane pans from
 * anywhere, so a click never reaches a node — it lands on the pane, and the
 * node under it is found by geometry from React Flow's measured boxes.
 */
function nodeRects(instance: ReactFlowInstance): NodeRect[] {
  return instance.getNodes().map((n) => {
    const absolute = instance.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position
    return { id: n.id, x: absolute.x, y: absolute.y, width: n.measured?.width ?? n.width ?? 0, height: n.measured?.height ?? n.height ?? 0 }
  })
}

const COUNT_HIDDEN = { includeHiddenNodes: true }

/**
 * The real node components, each rendered inside an `inert` subtree. The node
 * components carry live controls — run strips, prompt fields, pickers — and
 * `nodesFocusable={false}` only drops the tab stop on React Flow's wrapper,
 * not on what the component renders inside it. `inert` takes the whole
 * subtree out of the tab order, the accessibility tree and hit testing, so a
 * keyboard user in the dialog's focus trap cannot land in a template's prompt
 * field and type into the editor store. Built once: a fresh component type per
 * render would remount every node.
 */
const READ_ONLY_NODE_TYPES: NodeTypes = Object.fromEntries(
  Object.entries(nodeTypes).map(([type, Component]) => {
    const Live = Component as ComponentType<NodeProps>
    function ReadOnlyNode(props: NodeProps) {
      return (
        <div inert>
          <Live {...props} />
        </div>
      )
    }
    ReadOnlyNode.displayName = `ReadOnly(${type})`
    return [type, ReadOnlyNode]
  }),
)

/**
 * Frames the graph once its nodes are measured — read two ways, as the
 * tutorial canvas does, because the store flag stalls on some snapshots while
 * the direct walk reports them ready. `useRevealDecision` owns the deadline
 * that keeps "never visible" unreachable.
 */
function FitWhenReady({ empty, onReady }: { readonly empty: boolean; readonly onReady: () => void }) {
  const storeFlag = useNodesInitialized()
  const measured = useNodesInitialized(COUNT_HIDDEN)
  const reveal = useRevealDecision(storeFlag || measured, empty)
  const { fitView } = useReactFlow()
  const done = useRef(false)

  useEffect(() => {
    if (!reveal || done.current) return
    done.current = true
    if (!empty) fitView({ padding: 0.1, minZoom: 0.02 })
    // Reveal after the fit transform has been applied, so the first paint is
    // the finished framing rather than the jump to it.
    requestAnimationFrame(onReady)
  }, [reveal, empty, fitView, onReady])

  return null
}

/**
 * A template's snapshot rendered through the real node components, with a
 * plain ReactFlow — NOT the editor's WorkflowCanvas, which is wired to the
 * workflow store and autosave. Nothing here can mutate the template: the
 * nodes are inert (see above, plus `.templates-canvas` in globals.css), only
 * the pane moves.
 *
 * `interactive: false` makes it a still — the detail modal's hero — that is
 * inert as a whole: it neither pans nor zooms, so a wheel over it scrolls the
 * modal, and it holds nothing to tab into.
 *
 * `children` render inside the provider, so canvas chrome (a zoom pill) can
 * use the React Flow hooks.
 */
export function ReadOnlyCanvas({
  nodes,
  edges,
  interactive,
  className,
  children,
}: {
  readonly nodes: readonly unknown[]
  readonly edges: readonly unknown[]
  readonly interactive: boolean
  readonly className?: string
  readonly children?: ReactNode
}) {
  const prepared = useMemo(() => {
    // Migrate first: an edge pointing at a handle that has since been renamed
    // is dropped by React Flow without a word.
    const migrated = migrateSnapshot(nodes as WorkflowNode[], edges as WorkflowEdge[])
    // Every node the template carries, sticky notes included: the notes are
    // the template's own explanation of itself (the tutorial templates put a
    // step-by-step note beside every input), and a preview that hid them
    // showed the machine without its manual.
    return {
      nodes: orderNodesParentFirst(migrated.nodes as unknown as Node[]),
      edges: migrated.edges as unknown as Edge[],
    }
  }, [nodes, edges])
  const [ready, setReady] = useState(false)
  // Reading a node in full: a click on the interactive canvas opens the
  // inspector for the node under it; a click on empty ground closes it.
  const instanceRef = useRef<ReactFlowInstance | null>(null)
  const [inspected, setInspected] = useState<InspectorNode | null>(null)
  const closeInspector = useCallback(() => setInspected(null), [])
  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      const instance = instanceRef.current
      if (!instance) return
      const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = nodeAtPoint(nodeRects(instance), point)
      const node = id === null ? null : prepared.nodes.find((n) => n.id === id)
      setInspected(node ? { id: node.id, type: node.type, data: node.data as Record<string, unknown> } : null)
    },
    [prepared.nodes],
  )

  return (
    <div
      className={cn("templates-canvas relative", !interactive && "templates-canvas-still", className)}
      data-ready={ready}
    >
      <ReactFlowProvider>
        <div className="absolute inset-0" inert={!interactive}>
          <ReactFlow
            nodes={prepared.nodes}
            edges={prepared.edges}
            nodeTypes={READ_ONLY_NODE_TYPES}
            onInit={(instance) => {
              instanceRef.current = instance
            }}
            onPaneClick={interactive ? onPaneClick : undefined}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={interactive}
            zoomOnScroll={interactive}
            zoomOnPinch={interactive}
            zoomOnDoubleClick={false}
            // A whole workflow is far wider than the pane, so the fit lands
            // well below React Flow's default 0.5 floor.
            minZoom={0.02}
            proOptions={{ hideAttribution: true }}
            // The editor's ground: the canvas colour plus the soft pink and
            // indigo wash behind the flow. A template is shown the way the
            // flow looks in the editor, not on a flat page colour (Asaf).
            className="canvas-ambient"
          >
            {/* The dots must stay transparent or they would paint over the wash. */}
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--home-line)" className="!bg-transparent" />
            <FitWhenReady empty={prepared.nodes.length === 0} onReady={() => setReady(true)} />
          </ReactFlow>
        </div>
        {children}
        {interactive && inspected && <NodeInspector node={inspected} onClose={closeInspector} />}
      </ReactFlowProvider>
    </div>
  )
}
