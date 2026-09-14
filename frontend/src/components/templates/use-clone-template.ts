import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { cloneTemplate } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { resolveDefaultProjectId } from "@/lib/default-project"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { useT } from "@/lib/i18n"

/**
 * "Clone & customize": copy the template into the caller's default project
 * (the same "My Recent Flows" quick-create lands in) and open the copy in the
 * editor. The design drops the project picker — a clone is a starting point,
 * and the editor can move it to any project later.
 *
 * `isCloning` stays true through navigation: the editor chunk is lazy-loaded,
 * so the first open can take a few seconds and the button must not look dead.
 */
export function useCloneTemplate(): {
  readonly clone: (template: { readonly slug: string; readonly name: string }) => Promise<void>
  readonly isCloning: boolean
} {
  const t = useT()
  const navigate = useNavigate()
  const [isCloning, setIsCloning] = useState(false)

  const clone = useCallback(
    async (template: { readonly slug: string; readonly name: string }) => {
      if (isCloning) return
      setIsCloning(true)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          toast.error(t("templates.signInToClone"))
          setIsCloning(false)
          return
        }
        const resolved = await resolveDefaultProjectId(supabase, user.id)
        if ("error" in resolved) {
          toast.error(t("templates.cloneProjectFailed", { message: resolved.error }))
          setIsCloning(false)
          return
        }
        const result = await cloneTemplate(template.slug, resolved.projectId, template.name)
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
        toast.success(t("templates.cloneSuccess"))
        navigate(`/projects/${result.projectId}/workflows/${result.workflowId}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("templates.cloneFailed"))
        setIsCloning(false)
      }
    },
    [isCloning, navigate, t],
  )

  return { clone, isCloning }
}
