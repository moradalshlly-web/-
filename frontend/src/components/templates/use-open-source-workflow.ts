import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

/**
 * Opens the workflow a template was published from — the only place its
 * content can change (edit, then Present → Template → Update Template
 * re-snapshots it). The editor's URL needs the project, which the template
 * row does not carry, so the workflow row is read first; a deleted source
 * says so instead of landing on a dead page.
 */
export function useOpenSourceWorkflow(): {
  readonly open: (workflowId: string) => Promise<void>
  readonly openingId: string | null
} {
  const t = useT()
  const navigate = useNavigate()
  const [openingId, setOpeningId] = useState<string | null>(null)

  const open = useCallback(
    async (workflowId: string) => {
      setOpeningId(workflowId)
      try {
        const { data, error } = await createClient().from("workflows").select("project_id").eq("id", workflowId).maybeSingle()
        if (error || !data?.project_id) {
          toast.error(t("templates.sourceMissing"))
          return
        }
        navigate(`/projects/${data.project_id}/workflows/${workflowId}`)
      } finally {
        setOpeningId(null)
      }
    },
    [navigate, t],
  )

  return { open, openingId }
}
