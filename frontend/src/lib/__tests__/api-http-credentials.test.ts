/**
 * The credentials client + the gate's typed error. Same harness as
 * api-error-dispatch: supabase's session is mocked, `fetch` is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import {
  CredentialUnboundError,
  createHttpCredential,
  deleteHttpCredential,
  isEncryptionKeyMissingError,
  listHttpCredentials,
  lockHttpCredential,
  sendWebhookOutput,
  shareWorkflow,
} from "../api"

function okJson(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({ ok: true, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })
}
function errJson(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("stored HTTP credentials client", () => {
  it("lists from GET /v1/http-credentials", async () => {
    const fetchMock = okJson({ data: [{ id: "c1", name: "CRM" }] })
    vi.stubGlobal("fetch", fetchMock)
    const res = await listHttpCredentials()
    expect(res.data).toEqual([{ id: "c1", name: "CRM" }])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/v1\/http-credentials$/)
    expect(init.method ?? "GET").toBe("GET")
  })

  it("creates with POST and sends exactly the form fields", async () => {
    const fetchMock = okJson({ data: { id: "c9" } }, 201)
    vi.stubGlobal("fetch", fetchMock)
    await createHttpCredential({ name: "Bot", headerName: "Authorization", secret: "Bearer x", boundUrl: null, boundMatch: "exact" })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ name: "Bot", headerName: "Authorization", secret: "Bearer x", boundUrl: null, boundMatch: "exact" })
  })

  it("the one-click lock is a PATCH binding the credential to exactly the node's URL", async () => {
    const fetchMock = okJson({ data: { id: "c1", boundUrl: "https://crm.example.com/hooks/in", boundMatch: "exact" } })
    vi.stubGlobal("fetch", fetchMock)
    await lockHttpCredential("c1", "https://crm.example.com/hooks/in")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/v1\/http-credentials\/c1$/)
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ boundUrl: "https://crm.example.com/hooks/in", boundMatch: "exact" })
  })

  it("deletes with DELETE", async () => {
    const fetchMock = okJson({ deleted: true })
    vi.stubGlobal("fetch", fetchMock)
    expect(await deleteHttpCredential("c1")).toEqual({ deleted: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("DELETE")
  })

  it("the webhook send carries credentialId when the node has one — and only then", async () => {
    const fetchMock = okJson({ jobId: "j", success: true, statusCode: 200, responseBody: "" })
    vi.stubGlobal("fetch", fetchMock)
    await sendWebhookOutput({ url: "https://h.example/x", payload: { a: 1 }, credentialId: "c1" })
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ credentialId: "c1" })
    await sendWebhookOutput({ url: "https://h.example/x", payload: { a: 1 } })
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).not.toHaveProperty("credentialId")
  })
})

describe("the gate's error", () => {
  it("409 credential_unbound becomes CredentialUnboundError carrying the uses", async () => {
    const details = [
      { nodeId: "hook-1", nodeLabel: "Deliver", credentialId: "c1", nodeUrl: "https://crm.example.com/hooks/in", kind: "plain", credentialName: "CRM" },
    ]
    vi.stubGlobal("fetch", errJson(409, { error: { code: "credential_unbound", message: "Lock it first", details } }))
    let caught: unknown
    try {
      await shareWorkflow("00000000-0000-4000-8000-000000000020")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CredentialUnboundError)
    expect((caught as CredentialUnboundError).details).toEqual(details)
    expect((caught as CredentialUnboundError).message).toBe("Lock it first")
  })

  it("a credential_unbound body without details still throws the typed error with an empty list", async () => {
    vi.stubGlobal("fetch", errJson(409, { error: { code: "credential_unbound", message: "Lock it first" } }))
    await expect(shareWorkflow("00000000-0000-4000-8000-000000000020")).rejects.toMatchObject({ name: "CredentialUnboundError", details: [] })
  })

  it("503 encryption_key_missing is recognisable by code", async () => {
    vi.stubGlobal("fetch", errJson(503, { error: { code: "encryption_key_missing", message: "No instance encryption key" } }))
    let caught: unknown
    try {
      await createHttpCredential({ name: "x", headerName: "X-A", secret: "s" })
    } catch (err) {
      caught = err
    }
    expect(isEncryptionKeyMissingError(caught)).toBe(true)
    expect(isEncryptionKeyMissingError(new Error("other"))).toBe(false)
  })
})
