/**
 * Stored HTTP credentials — the settings surface behind Webhook Output.
 *
 * Browser session ONLY (`req.authKind === "jwt"`, 403 `in_app_only` otherwise,
 * the copilot's precedent): an OAuth app token or a personal API token sets
 * `req.userId` to the resource owner and would otherwise reach these routes
 * like any other — an app connected to "read my jobs" could list credential
 * ids and spend them. Per-route scopes are opt-in and essentially unused, so
 * the pin is the gate.
 *
 * No response carries a ciphertext and there is no "reveal": rotating a secret
 * is a PATCH with a new `secret`. The binding is a ratchet — PATCH may set or
 * move `boundUrl`, never clear it (`lib/http-credentials.ts`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { rateLimiter } from "../middleware/rate-limit.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { EncryptionKeyMissingError } from "../lib/instance-cipher.js"
import {
  HttpCredentialError,
  createHttpCredential,
  deleteHttpCredential,
  httpCredentialBoundMatchSchema,
  httpCredentialBoundUrlSchema,
  httpCredentialHeaderNameSchema,
  httpCredentialNameSchema,
  httpCredentialSecretSchema,
  listHttpCredentials,
  updateHttpCredential,
  type HttpCredentialErrorCode,
} from "../lib/http-credentials.js"

const idParams = z.object({ id: z.string().uuid() })

const createBody = z.object({
  name: httpCredentialNameSchema,
  headerName: httpCredentialHeaderNameSchema,
  secret: httpCredentialSecretSchema,
  boundUrl: httpCredentialBoundUrlSchema.nullable().optional(),
  boundMatch: httpCredentialBoundMatchSchema.optional(),
})

const updateBody = z
  .object({
    name: httpCredentialNameSchema.optional(),
    headerName: httpCredentialHeaderNameSchema.optional(),
    secret: httpCredentialSecretSchema.optional(),
    boundUrl: httpCredentialBoundUrlSchema.nullable().optional(),
    boundMatch: httpCredentialBoundMatchSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing to update",
  })

/** In-app only — see the module docstring. */
function requireJwt(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return false
  }
  if (req.authKind !== "jwt") {
    reply.status(403).send({
      error: { code: "in_app_only", message: "Stored credentials are managed in the Nodaro app only." },
    })
    return false
  }
  return true
}

const ERROR_STATUS: Record<HttpCredentialErrorCode, number> = {
  not_found: 404,
  name_taken: 409,
  limit_reached: 409,
  binding_required: 409,
  prefix_needs_path: 400,
  // Resolution-time codes never surface from these routes; mapped so a new
  // caller cannot turn one into a 500.
  no_owner: 400,
  unbound_shared_run: 400,
  destination_mismatch: 400,
  invalid_row: 400,
}

function sendKnownError(reply: FastifyReply, req: FastifyRequest, err: unknown, fallback: string): FastifyReply {
  if (err instanceof HttpCredentialError) {
    return reply.status(ERROR_STATUS[err.code]).send({ error: { code: err.code, message: err.message } })
  }
  if (err instanceof EncryptionKeyMissingError) {
    // Operator-actionable, and already free of anything secret.
    return reply.status(503).send({ error: { code: "encryption_key_missing", message: err.message } })
  }
  return sendInternalError(reply, req, err, fallback)
}

export async function httpCredentialRoutes(app: FastifyInstance) {
  // Fail closed: a Redis outage must not also remove the cap on secret writes.
  const writeLimit = rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "http-credentials-write", failClosed: true })

  app.get("/v1/http-credentials", async (req, reply) => {
    if (!requireJwt(req, reply)) return
    try {
      const data = await listHttpCredentials(req.userId!)
      return reply.send({ data })
    } catch (err) {
      return sendKnownError(reply, req, err, "Failed to list credentials")
    }
  })

  app.post("/v1/http-credentials", { preHandler: writeLimit }, async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      const data = await createHttpCredential(req.userId!, parsed.data)
      return reply.status(201).send({ data })
    } catch (err) {
      return sendKnownError(reply, req, err, "Failed to create credential")
    }
  })

  app.patch("/v1/http-credentials/:id", { preHandler: writeLimit }, async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const params = idParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid credential id" } })
    }
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      const data = await updateHttpCredential(req.userId!, params.data.id, parsed.data)
      return reply.send({ data })
    } catch (err) {
      return sendKnownError(reply, req, err, "Failed to update credential")
    }
  })

  app.delete("/v1/http-credentials/:id", { preHandler: writeLimit }, async (req, reply) => {
    if (!requireJwt(req, reply)) return
    const params = idParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid credential id" } })
    }
    try {
      const deleted = await deleteHttpCredential(req.userId!, params.data.id)
      if (!deleted) {
        return reply.status(404).send({ error: { code: "not_found", message: "Credential not found" } })
      }
      return reply.send({ deleted: true })
    } catch (err) {
      return sendKnownError(reply, req, err, "Failed to delete credential")
    }
  })
}
