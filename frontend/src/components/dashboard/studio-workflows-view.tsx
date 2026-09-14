import { useProjectDisplayName } from "@/lib/project-display-name"
import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { WorkflowThumbnail } from "./workflow-thumbnail"
import {
  useMyStudioWorkflows,
  useAllStudioWorkflows,
  type MyWorkflow,
} from "@/hooks/queries/use-my-workflows-queries"

interface StudioWorkflowsViewProps {
  /** Admin "All users" switch is on — show every user's Studio workflows. */
  readonly showAll: boolean
  /**
   * Controlled search text — the home screen's Jump back in field. When set,
   * the view renders no heading row of its own.
   */
  readonly search?: string
}

/**
 * "Studio Workflows" dashboard tab — workflows that originated in
 * studio.nodaro.ai (app_slug = 'studio'). Visible to everyone: each user sees
 * their own; admins can flip the "All users" switch to see everyone's (with the
 * owner email shown). Cards open the in-app editor (read-only for Studio
 * projects, as elsewhere).
 */
export function StudioWorkflowsView({ showAll, search: controlledSearch }: StudioWorkflowsViewProps) {
  const projectDisplayName = useProjectDisplayName()
  const mine = useMyStudioWorkflows()
  const all = useAllStudioWorkflows(showAll)

  const workflows: MyWorkflow[] = showAll ? (all.data?.data ?? []) : (mine.data ?? [])
  const isLoading = showAll ? all.isLoading : mine.isLoading

  const [ownSearch, setOwnSearch] = useState("")
  const search = controlledSearch ?? ownSearch
  const filtered = useMemo(() => {
    if (!search.trim()) return workflows
    const needle = search.toLowerCase()
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        (w.ownerEmail?.toLowerCase().includes(needle) ?? false) ||
        w.projectName.toLowerCase().includes(needle) ||
        projectDisplayName({ name: w.projectName, isDefault: w.projectIsDefault }).toLowerCase().includes(needle),
    )
  }, [workflows, search])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">
          {showAll ? "No Studio workflows found." : "No Studio workflows yet."}
        </p>
      </div>
    )
  }

  return (
    <>
      {controlledSearch === undefined && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {showAll ? "Studio Workflows — all users" : "Studio Workflows"}
          </h2>
          <div className="relative w-48">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={ownSearch}
              onChange={(e) => setOwnSearch(e.target.value)}
              placeholder="Search Studio workflows..."
              aria-label="Search Studio workflows"
              className="ps-8 h-8 text-sm w-full"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No workflows match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
          {filtered.map((wf) => (
            <Link
              key={wf.id}
              to={`/projects/${wf.projectId}/workflows/${wf.id}`}
              className="group relative rounded-xl border bg-card hover:bg-accent/30 transition-colors overflow-hidden block"
            >
              <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} nodeTypes={wf.nodeTypes} />
              <div className="px-3 py-2.5">
                <p className="text-[13px] font-semibold truncate">{wf.name}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground truncate flex items-center gap-1">
                  {showAll && wf.ownerEmail && (
                    <>
                      <span className="truncate">{wf.ownerEmail}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="flex-shrink-0">
                    {new Date(wf.updatedAt).toLocaleDateString()}
                  </span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
