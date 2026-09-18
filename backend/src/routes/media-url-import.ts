import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { importRecordingFromUrl } from "../lib/media-url-import.js"

/**
 * POST /v1/media/import-recording — import a remote AUDIO/VIDEO recording (up to
 * the podcast ceiling) into the caller's storage. The long-file ingest lane for
 * the podcast-editing primitives (Q7 option C): a browser can't upload a
 * multi-GB file (500 MB web cap) and presigned direct-to-R2 is CI-forbidden, so
 * the backend fetches the user-hosted URL server-side (SSRF-gated, streamed,
 * policed) and lands it on R2 — after which it behaves like any uploaded asset.
 *
 * Body:      { url: string }   (http(s); `safeUrlSchema` + `safeFetch` SSRF gates)
 * Response:  { data: { url, assetId, mimeType, sizeBytes, durationSec, kind, filename } }
 * Errors:    400 validation_error (not audio/video / undecodable),
 *            403 upload_blocked (deployment policy),
 *            413 file_too_large | duration_exceeded | storage_limit_exceeded,
 *            422 fetch_failed (unreachable / non-2xx origin).
 *
 * All fetch/validation/storage semantics live in lib/media-url-import.ts.
 */

export const mediaImportRecordingBody = z.object({
  url: safeUrlSchema,
})

export async function mediaUrlImportRoutes(app: FastifyInstance) {
  app.post(
    "/v1/media/import-recording",
    // A server-side multi-GB fetch is expensive; cap request rate on top of the
    // per-user/global in-flight caps in the lib.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const parsed = mediaImportRecordingBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // Cancel the server-side download if the client hangs up — a
      // disconnected request must not keep streaming for 40 minutes.
      const ac = new AbortController()
      req.raw.on("close", () => ac.abort())

      const result = await importRecordingFromUrl(userId, parsed.data.url, { signal: ac.signal })
      if (!result.ok) {
        return reply.status(result.status).send({
          error: { code: result.code, message: result.message, ...(result.details ?? {}) },
        })
      }

      const { ok: _ok, ...data } = result
      return { data }
    },
  )
}
