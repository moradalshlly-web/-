import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listApiTokens,
  createApiToken,
  updateApiToken,
  deleteApiToken,
  deleteOrAlreadyGone,
  type ApiToken,
  type CreateApiTokenResult,
} from "@/lib/api"

export function useApiTokens() {
  return useQuery({
    queryKey: queryKeys.apiTokens.list(),
    queryFn: async () => {
      const res = await listApiTokens()
      return res.data
    },
    staleTime: 30_000,
  })
}

export function useCreateApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      name: string
      workflowIds?: string[]
      rateLimit?: number
    }): Promise<CreateApiTokenResult> => {
      const res = await createApiToken(params)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}

export function useUpdateApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...params
    }: {
      id: string
      name?: string
      workflowIds?: string[]
      rateLimit?: number
      isActive?: boolean
    }): Promise<ApiToken> => {
      const res = await updateApiToken(id, params)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}

export function useDeleteApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    // A token another tab already revoked answers 404: that is the state the
    // click asked for, so the list is refreshed instead of an error (#722).
    mutationFn: async (id: string) => deleteOrAlreadyGone(deleteApiToken(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}
