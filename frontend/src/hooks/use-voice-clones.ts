import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVoiceClones, deleteVoiceClone } from "@/lib/api"

const STALE_TIME = 60_000 // 1 minute

/** The user's pre-retirement voice clones. Voice cloning itself was retired
 *  (2026-09-15) — there is no create hook any more; list / delete stay so the
 *  clones a user already made remain pickable and removable. */
export function useVoiceClones(enabled = true) {
  return useQuery({
    queryKey: queryKeys.voices.clones(),
    queryFn: getVoiceClones,
    staleTime: STALE_TIME,
    enabled,
  })
}

export function useDeleteVoiceClone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteVoiceClone,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voices.clones() }),
  })
}
