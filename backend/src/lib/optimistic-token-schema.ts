import { z } from "zod"

/**
 * The optimistic-concurrency token a client echoes back from a row it read:
 * the row's own `updated_at`. Postgres hands that out with a numeric offset
 * (`2026-09-16T09:46:43.943444+00:00`), which a bare `z.string().datetime()`
 * rejects as "Invalid ISO datetime" — the request then fails before the
 * concurrency check ever runs (the object studio's "Failed to start object
 * generation"). One schema, offset-tolerant, for every route that takes the
 * token; a guard test keeps the bare form out of the routes.
 */
export const expectedUpdatedAtSchema = z.string().datetime({ offset: true }).optional()
