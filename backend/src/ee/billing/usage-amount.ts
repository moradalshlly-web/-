/** The hold and final charge differ after partial settlement. Null stays unknown. */
export function usageAmount(row: { status?: string | null; credits_used?: number | null; credits_charged?: number | null }): number | null {
  if (row.status === "refunded") return 0
  if (row.status === "committed") return row.credits_charged ?? row.credits_used ?? null
  return row.credits_used ?? null
}
