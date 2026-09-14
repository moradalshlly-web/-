import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
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
} from "@xyflow/react"
import { nodeTypes } from "@/components/nodes"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { migrateSnapshot } from "@/components/tutorials/migrate-snapshot"
import { useRevealDecision } from "@/components/tutorials/use-reveal-decision"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { cn } from "@/lib/utils"
import "@xyflow/react/dist/style.css"

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
    // Sticky notes are poster-sized in the larger templates and would bury
    // the machine the preview exists to show; the clone still has them, and
    // the canvas preview says how many were left out.
    const visible = migrated.nodes.filter((node) => node.type !== "sticky-note")
    return {
      nodes: orderNodesParentFirst(visible as unknown as Node[]),
      edges: migrated.edges as unknown as Edge[],
    }
  }, [nodes, edges])
  const [ready, setReady] = useState(false)

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
            style={{ background: "transparent" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--home-line)" />
            <FitWhenReady empty={prepared.nodes.length === 0} onReady={() => setReady(true)} />
          </ReactFlow>
        </div>
        {children}
      </ReactFlowProvider>
    </div>
  )
}
