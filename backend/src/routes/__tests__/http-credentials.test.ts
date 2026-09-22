/**
 * `/v1/http-credentials` — the route layer over `lib/http-credentials.ts`:
 * the browser-session pin, Zod at the boundary (the lib's own schemas), the
 * error mapping, and the shape of what leaves (never a ciphertext).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock("@/middleware/rate-limit.js", () => ({
  rateLimiter: () => async () => {},
}))

vi.mock("@/lib/http-credentials.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http-credentials.js")>()
  return {
    ...actual,
    listHttpCredentials: mocks.list,
    createHttpCredential: mocks.create,
    updateHttpCredential: mocks.update,
    deleteHttpCredential: mocks.remove,
  }
})

import { httpCredentialRoutes } from "../http-credentials.js"
import { HttpCredentialError } from "../../lib/http-credentials.js"
import { EncryptionKeyMissingError } from "../../lib/instance-cipher.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CRED_ID = "00000000-0000-4000-8000-0000000000c1"
const SUMMARY = {
  id: CRED_ID,
  name: "Grok bot",
  authKind: "header",
  headerName: "Authorization",
  boundUrl: null,
  boundMatch: "exact",
  createdAt: "2026-09-22T00:00:00.000Z",
  updatedAt: "2026-09-22T00:00:00.000Z",
}

let app: FastifyInstance
let authKind: "jwt" | "api_token" | "app_token" | "internal" | undefined = "jwt"
let userId: string | undefined = USER

beforeEach(async () => {
  vi.clearAllMocks()
  authKind = "jwt"
  userId = USER
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = userId
    req.authKind = authKind
  })
  await app.register(httpCredentialRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("browser session only", () => {
  it.each(["api_token", "app_token", "internal"] as const)("answers 403 in_app_only to a %s caller on every route", async (kind) => {
    authKind = kind
    const calls = [
      app.inject({ method: "GET", url: "/v1/http-credentials" }),
      app.inject({ method: "POST", url: "/v1/http-credentials", payload: { name: "x", headerName: "X-A", secret: "s" } }),
      app.inject({ method: "PATCH", url: `/v1/http-credentials/${CRED_ID}`, payload: { name: "y" } }),
      app.inject({ method: "DELETE", url: `/v1/http-credentials/${CRED_ID}` }),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("answers 401 with no user at all", async () => {
    userId = undefined
    const res = await app.inject({ method: "GET", url: "/v1/http-credentials" })
    expect(res.statusCode).toBe(401)
  })
})

describe("GET /v1/http-credentials", () => {
  it("lists the caller's credentials — summaries only, no ciphertext, no secret", async () => {
    mocks.list.mockResolvedValue([SUMMARY])
    const res = await app.inject({ method: "GET", url: "/v1/http-credentials" })
    expect(res.statusCode).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(USER)
    expect(res.json()).toEqual({ data: [SUMMARY] })
    expect(res.body).not.toContain("ciphertext")
    expect(res.body).not.toContain("secret")
  })
})

describe("POST /v1/http-credentials", () => {
  it("creates with the lib's own validation and answers 201 with the summary", async () => {
    mocks.create.mockResolvedValue(SUMMARY)
    const res = await app.inject({
      method: "POST",
      url: "/v1/http-credentials",
      payload: { name: " Grok bot ", headerName: "Authorization", secret: "Bearer crsr_1", boundUrl: "https://hooks.example.com/in/abc?x=1", boundMatch: "exact" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: SUMMARY })
    expect(mocks.create).toHaveBeenCalledWith(USER, {
      name: "Grok bot",
      headerName: "Authorization",
      secret: "Bearer crsr_1",
      boundUrl: "https://hooks.example.com/in/abc",
      boundMatch: "exact",
    })
    expect(res.body).not.toContain("crsr_1")
  })

  it.each([
    ["a blocked header name", { name: "x", headerName: "Cookie", secret: "s" }],
    ["a multi-line secret", { name: "x", headerName: "X-A", secret: "a\nb" }],
    ["an http binding", { name: "x", headerName: "X-A", secret: "s", boundUrl: "http://api.example.com/hook" }],
    ["a private-host binding", { name: "x", headerName: "X-A", secret: "s", boundUrl: "https://127.0.0.1/hook" }],
    ["a missing name", { headerName: "X-A", secret: "s" }],
  ])("refuses %s with 400 validation_error before touching the vault", async (_label, payload) => {
    const res = await app.inject({ method: "POST", url: "/v1/http-credentials", payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("maps the vault's typed errors and the missing instance key", async () => {
    mocks.create.mockRejectedValueOnce(new HttpCredentialError("name_taken"))
    const taken = await app.inject({ method: "POST", url: "/v1/http-credentials", payload: { name: "x", headerName: "X-A", secret: "s" } })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error.code).toBe("name_taken")

    mocks.create.mockRejectedValueOnce(new HttpCredentialError("limit_reached"))
    const limit = await app.inject({ method: "POST", url: "/v1/http-credentials", payload: { name: "x", headerName: "X-A", secret: "s" } })
    expect(limit.statusCode).toBe(409)
    expect(limit.json().error.code).toBe("limit_reached")

    mocks.create.mockRejectedValueOnce(new EncryptionKeyMissingError())
    const noKey = await app.inject({ method: "POST", url: "/v1/http-credentials", payload: { name: "x", headerName: "X-A", secret: "s" } })
    expect(noKey.statusCode).toBe(503)
    expect(noKey.json().error.code).toBe("encryption_key_missing")
    expect(noKey.json().error.message).toContain("NODARO_ENCRYPTION_KEY")
  })
})

describe("PATCH /v1/http-credentials/:id", () => {
  it("updates and answers the summary; the binding ratchet surfaces as 409", async () => {
    mocks.update.mockResolvedValueOnce({ ...SUMMARY, boundUrl: "https://api.corp.com/hooks", boundMatch: "prefix" })
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/http-credentials/${CRED_ID}`,
      payload: { boundUrl: "https://api.corp.com/hooks/", boundMatch: "prefix" },
    })
    expect(res.statusCode).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(USER, CRED_ID, { boundUrl: "https://api.corp.com/hooks/", boundMatch: "prefix" })
    expect(res.json().data.boundMatch).toBe("prefix")

    mocks.update.mockRejectedValueOnce(new HttpCredentialError("binding_required"))
    const cleared = await app.inject({ method: "PATCH", url: `/v1/http-credentials/${CRED_ID}`, payload: { boundUrl: null } })
    expect(cleared.statusCode).toBe(409)
    expect(cleared.json().error.code).toBe("binding_required")

    mocks.update.mockRejectedValueOnce(new HttpCredentialError("not_found"))
    const missing = await app.inject({ method: "PATCH", url: `/v1/http-credentials/${CRED_ID}`, payload: { name: "z" } })
    expect(missing.statusCode).toBe(404)
  })

  it("refuses an empty patch and a non-uuid id", async () => {
    const empty = await app.inject({ method: "PATCH", url: `/v1/http-credentials/${CRED_ID}`, payload: {} })
    expect(empty.statusCode).toBe(400)
    const badId = await app.inject({ method: "PATCH", url: "/v1/http-credentials/not-a-uuid", payload: { name: "z" } })
    expect(badId.statusCode).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("DELETE /v1/http-credentials/:id", () => {
  it("answers { deleted: true }, or 404 when the scoped delete matched nothing", async () => {
    mocks.remove.mockResolvedValueOnce(true)
    const ok = await app.inject({ method: "DELETE", url: `/v1/http-credentials/${CRED_ID}` })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ deleted: true })
    expect(mocks.remove).toHaveBeenCalledWith(USER, CRED_ID)

    mocks.remove.mockResolvedValueOnce(false)
    const gone = await app.inject({ method: "DELETE", url: `/v1/http-credentials/${CRED_ID}` })
    expect(gone.statusCode).toBe(404)
  })
})
