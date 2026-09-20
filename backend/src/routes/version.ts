import type { FastifyInstance } from "fastify"
import { getUpdateStatus } from "../lib/update-check.js"

/**
 * GET /v1/version — the running version + whether a newer release exists
 * (the sidebar red dot reads this; versioning spec, 2026-08-19).
 * Public on purpose, like /health: presence data only, nothing tenant-scoped.
 * On cloud (or NODARO_UPDATE_CHECK=off) it degrades to
 * { current, updateAvailable: false } without any outbound request.
 */
export async function versionRoutes(app: FastifyInstance) {
  app.get("/v1/version", async (_req, reply) => {
    const status = await getUpdateStatus()
    // `latest: null` is "not known yet" (the release read has not succeeded) or
    // "switched off" — either way not an answer worth pinning in a browser or a
    // proxy for an hour while the backend is already trying again.
    const maxAge = status.latest ? 3600 : 60
    return reply.header("Cache-Control", `public, max-age=${maxAge}`).send(status)
  })
}
