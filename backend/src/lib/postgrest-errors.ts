/**
 * PostgREST's "no such column" — schema-cache `PGRST204`, or Postgres
 * `42703` once the statement runs. A column that arrives with a migration
 * reaches the shared database only when `main` deploys, and staging runs
 * ahead of it; a writer that can live without the column checks this and
 * writes again without it (the safe answer is always the column's default).
 */
export function isMissingColumnError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703"
}
