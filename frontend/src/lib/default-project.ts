import type { createClient } from "@/lib/supabase"
import { getActiveWorkspaceId } from "@/lib/workspace-context"

/** The fallback project's name — what `ensure_default_project()` names it too. */
export const DEFAULT_PROJECT_NAME = "My Recent Flows"

export type DefaultProjectResult = { readonly projectId: string } | { readonly error: string }

/**
 * The caller's default project, where quick-created workflows and cloned
 * templates land. `ensure_default_project()` (RPC from migration 116) returns
 * it, lazy-creating it on the first call. If the RPC isn't there yet — the
 * migration hasn't applied to this environment — or RLS refuses it, we degrade
 * gracefully: find or create a regular project of the same name, so the user
 * is never stuck. Once the migration applies the RPC takes over and the partial
 * unique index keeps the default singleton.
 */
export async function resolveDefaultProjectId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<DefaultProjectResult> {
  const { data: rpcId, error: rpcErr } = await supabase.rpc("ensure_default_project")
  if (!rpcErr && typeof rpcId === "string") return { projectId: rpcId }

  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", DEFAULT_PROJECT_NAME)
    .limit(1)
    .maybeSingle()
  if (existing?.id) return { projectId: existing.id as string }

  const { data: created, error: createErr } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: DEFAULT_PROJECT_NAME,
      description: "Auto-created workspace for new workflows",
      // Lands in the scope the person is working in. The row policy decides
      // whether they may: admins always, members only when the workspace
      // allows it — the same rule the REST route runs.
      workspace_id: getActiveWorkspaceId(),
    })
    .select("id")
    .single()
  if (createErr || !created) return { error: createErr?.message ?? rpcErr?.message ?? "unknown error" }
  return { projectId: created.id as string }
}
