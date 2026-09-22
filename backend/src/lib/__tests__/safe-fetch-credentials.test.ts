/**
 * The credential lane of safeFetch (plan D5 / D6) — hermetic: undici is
 * replaced by a scripted fetch that answers 302s, so the manual redirect loop
 * runs for real against a fake wire.
 *
 * What is pinned: a credential rides only https; a BOUND credential is never
 * sent — first hop or redirect — outside its binding (the request fails
 * instead of following bare); a PLAIN credential is dropped by its OWN header
 * name, not only the fixed list, once a hop leaves the initial origin, even
 * when the caller passed no `headers`; the lane never reaches undici as an
 * option; own storage refuses a credential outright.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock("undici", () => ({
  Agent: class {
    constructor(_opts?: unknown) {}
  },
  fetch: fetchMock,
}))

import { safeFetch } from "../safe-fetch.js"

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } })
}
function ok() {
  return new Response("done", { status: 200 })
}
function sentHeaders(call: number): Headers {
  const init = fetchMock.mock.calls[call]![1] as { headers?: HeadersInit }
  return new Headers(init.headers)
}
function sentInit(call: number): Record<string, unknown> {
  return fetchMock.mock.calls[call]![1] as Record<string, unknown>
}

const BOUND_EXACT = { url: "https://hooks.example.com/in/abc", match: "exact" as const }
const BOUND_PREFIX = { url: "https://hooks.example.com/in", match: "prefix" as const }
const CRED = { "X-API-Key": "secret-key" }

beforeEach(() => {
  fetchMock.mockReset()
})
afterEach(() => {
  delete process.env.R2_PUBLIC_URL
})

describe("safeFetch — first hop", () => {
  it("attaches the credential headers over the caller's headers and forwards NO lane options to undici", async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const res = await safeFetch("https://hooks.example.com/in/abc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentialHeaders: CRED,
      credentialBinding: BOUND_EXACT,
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentHeaders(0).get("x-api-key")).toBe("secret-key")
    expect(sentHeaders(0).get("content-type")).toBe("application/json")
    expect(sentInit(0)).not.toHaveProperty("credentialHeaders")
    expect(sentInit(0)).not.toHaveProperty("credentialBinding")
    expect(sentInit(0)).not.toHaveProperty("timeoutMs")
  })

  it("refuses a first hop outside the binding before opening a connection", async () => {
    await expect(
      safeFetch("https://hooks.example.com/admin/users", { credentialHeaders: CRED, credentialBinding: BOUND_EXACT }),
    ).rejects.toThrow(/outside the address this credential is locked to/)
    await expect(
      safeFetch("https://evil.example/in/abc", { credentialHeaders: CRED, credentialBinding: BOUND_PREFIX }),
    ).rejects.toThrow(/outside the address/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses plain http when a credential is attached — bound or plain", async () => {
    await expect(safeFetch("http://hooks.example.com/in/abc", { credentialHeaders: CRED })).rejects.toThrow(/only sent over https/)
    await expect(
      safeFetch("http://hooks.example.com/in/abc", { credentialHeaders: CRED, credentialBinding: BOUND_EXACT }),
    ).rejects.toThrow(/https|outside/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a credential aimed at this install's own storage", async () => {
    process.env.R2_PUBLIC_URL = "https://media.example.com/bucket"
    await expect(
      safeFetch("https://media.example.com/bucket/uploads/x.mp4", { credentialHeaders: CRED }),
    ).rejects.toThrow(/own storage/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an empty credential map is not a credential — the request behaves like any other", async () => {
    fetchMock.mockResolvedValueOnce(ok())
    await safeFetch("http://plain.example.com/hook", { credentialHeaders: {} })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("safeFetch — redirects with a BOUND credential", () => {
  it("does not follow a redirect that leaves the binding — no second request, nothing sent bare", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://hooks.example.com/admin/users"))
    await expect(
      safeFetch("https://hooks.example.com/in/abc", { credentialHeaders: CRED, credentialBinding: BOUND_EXACT }),
    ).rejects.toThrow(/redirect left the address/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not follow a cross-origin redirect either", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://collector.example/in/abc"))
    await expect(
      safeFetch("https://hooks.example.com/in/abc", { credentialHeaders: CRED, credentialBinding: BOUND_PREFIX }),
    ).rejects.toThrow(/redirect left the address/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("follows a redirect that stays inside a prefix binding, still carrying the credential", async () => {
    fetchMock.mockResolvedValueOnce(redirect("/in/abc/v2")).mockResolvedValueOnce(ok())
    const res = await safeFetch("https://hooks.example.com/in/abc", { credentialHeaders: CRED, credentialBinding: BOUND_PREFIX })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe("https://hooks.example.com/in/abc/v2")
    expect(sentHeaders(1).get("x-api-key")).toBe("secret-key")
  })
})

describe("safeFetch — redirects with a PLAIN credential", () => {
  it("drops the credential by its OWN header name on a cross-origin hop, and keeps ordinary headers", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://elsewhere.example/hook")).mockResolvedValueOnce(ok())
    await safeFetch("https://hooks.example.com/in/abc", {
      headers: { "Content-Type": "application/json", Authorization: "Bearer caller" },
      credentialHeaders: CRED,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentHeaders(0).get("x-api-key")).toBe("secret-key")
    expect(sentHeaders(1).get("x-api-key")).toBeNull()
    // The fixed list still goes too; ordinary headers survive.
    expect(sentHeaders(1).get("authorization")).toBeNull()
    expect(sentHeaders(1).get("content-type")).toBe("application/json")
  })

  it("strips on a cross-origin hop even when the caller passed no headers at all", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://elsewhere.example/hook")).mockResolvedValueOnce(ok())
    await safeFetch("https://hooks.example.com/in/abc", { credentialHeaders: CRED })
    expect(sentHeaders(0).get("x-api-key")).toBe("secret-key")
    expect(sentHeaders(1).get("x-api-key")).toBeNull()
  })

  it("keeps the credential across a same-origin redirect", async () => {
    fetchMock.mockResolvedValueOnce(redirect("/in/abc/moved")).mockResolvedValueOnce(ok())
    await safeFetch("https://hooks.example.com/in/abc", { credentialHeaders: CRED })
    expect(sentHeaders(1).get("x-api-key")).toBe("secret-key")
  })
})

describe("safeFetch — no credential (unchanged behaviour)", () => {
  it("still strips the fixed credential list from the caller's own headers on a cross-origin hop", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://elsewhere.example/x")).mockResolvedValueOnce(ok())
    await safeFetch("https://api.example.com/x", { headers: { Authorization: "Bearer t", "X-Trace": "1" } })
    expect(sentHeaders(1).get("authorization")).toBeNull()
    expect(sentHeaders(1).get("x-trace")).toBe("1")
  })

  it("follows a plain-http redirect chain as before when nothing secret is attached", async () => {
    fetchMock.mockResolvedValueOnce(redirect("http://other.example.com/y")).mockResolvedValueOnce(ok())
    const res = await safeFetch("http://api.example.com/x")
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
