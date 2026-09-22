/**
 * Stored HTTP credentials — the vault behind Webhook Output (plan D1–D7).
 *
 * A tiny in-memory PostgREST stands in for supabase: the same chains the
 * module issues (`select…eq…order`, `insert…select…single`, `update…eq…eq…
 * select…single`, `delete…eq…eq…select`, `select…in…eq`, the head count) —
 * enough to exercise ownership scoping, the ratchet and the resolver end to
 * end, with the real cipher underneath (test key).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockConfig, table } = vi.hoisted(() => ({
  mockConfig: { NODARO_ENCRYPTION_KEY: "b".repeat(64), SOCIAL_ENCRYPTION_KEY: "" },
  table: [] as Array<Record<string, unknown>>,
}))

vi.mock("../config.js", () => ({ config: mockConfig }))

vi.mock("../supabase.js", () => {
  let nextId = 1
  const now = () => new Date().toISOString()
  function pick(row: Record<string, unknown>, columns: string): Record<string, unknown> {
    const wanted = columns.split(",").map((c) => c.trim())
    return Object.fromEntries(wanted.filter((c) => c in row).map((c) => [c, row[c]]))
  }
  function builder() {
    const state: {
      op: "select" | "insert" | "update" | "delete"
      columns: string
      head: boolean
      eq: Array<[string, unknown]>
      inFilter: [string, unknown[]] | null
      payload: Record<string, unknown> | null
      single: "single" | "maybeSingle" | null
    } = { op: "select", columns: "*", head: false, eq: [], inFilter: null, payload: null, single: null }

    function matches(row: Record<string, unknown>): boolean {
      return state.eq.every(([k, v]) => row[k] === v) && (!state.inFilter || state.inFilter[1].includes(row[state.inFilter[0]]))
    }
    function run() {
      if (state.op === "insert") {
        const row = state.payload!
        if (table.some((r) => r.user_id === row.user_id && r.name === row.name)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } }
        }
        const full = { id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`, created_at: now(), updated_at: now(), ...row }
        table.push(full)
        return { data: pick(full, state.columns), error: null }
      }
      const rows = table.filter(matches)
      if (state.op === "update") {
        const patch = state.payload!
        if (patch.name !== undefined && table.some((r) => !matches(r) && r.user_id === rows[0]?.user_id && r.name === patch.name)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } }
        }
        for (const r of rows) Object.assign(r, patch)
        return state.single ? { data: rows[0] ? pick(rows[0], state.columns) : null, error: rows[0] ? null : { code: "PGRST116", message: "0 rows" } } : { data: rows.map((r) => pick(r, state.columns)), error: null }
      }
      if (state.op === "delete") {
        for (const r of rows) table.splice(table.indexOf(r), 1)
        return { data: rows.map((r) => pick(r, state.columns)), error: null }
      }
      if (state.head) return { data: null, count: rows.length, error: null }
      if (state.single === "single") return rows[0] ? { data: pick(rows[0], state.columns), error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } }
      if (state.single === "maybeSingle") return { data: rows[0] ? pick(rows[0], state.columns) : null, error: null }
      return { data: rows.map((r) => pick(r, state.columns)), error: null }
    }
    const api: Record<string, unknown> = {
      select(columns: string, opts?: { head?: boolean }) {
        if (state.op === "select") state.columns = columns
        else state.columns = columns
        if (opts?.head) state.head = true
        return api
      },
      insert(payload: Record<string, unknown>) { state.op = "insert"; state.payload = payload; return api },
      update(payload: Record<string, unknown>) { state.op = "update"; state.payload = payload; return api },
      delete() { state.op = "delete"; return api },
      eq(k: string, v: unknown) { state.eq.push([k, v]); return api },
      in(k: string, v: unknown[]) { state.inFilter = [k, v]; return api },
      order() { return api },
      single() { state.single = "single"; return Promise.resolve(run()) },
      maybeSingle() { state.single = "maybeSingle"; return Promise.resolve(run()) },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return api
  }
  return { supabase: { from: vi.fn(() => builder()) } }
})

import {
  HttpCredentialError,
  MAX_HTTP_CREDENTIALS_PER_USER,
  createHttpCredential,
  deleteHttpCredential,
  findUnboundCredentialUses,
  httpCredentialBoundUrlSchema,
  httpCredentialHeaderNameSchema,
  httpCredentialSecretSchema,
  listHttpCredentials,
  resolveHttpAuthHeaders,
  updateHttpCredential,
} from "../http-credentials.js"
import { decryptSecret, resetInstanceCipherForTests } from "../instance-cipher.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const STRANGER = "00000000-0000-4000-8000-0000000000a2"
const HOOK = "https://hooks.example.com/in/abc"

beforeEach(() => {
  table.length = 0
  mockConfig.NODARO_ENCRYPTION_KEY = "b".repeat(64)
  resetInstanceCipherForTests()
})

async function expectCode(promise: Promise<unknown>, code: string): Promise<HttpCredentialError> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(HttpCredentialError)
  expect((caught as HttpCredentialError).code).toBe(code)
  return caught as HttpCredentialError
}

describe("create / list — the secret is stored encrypted and never comes back", () => {
  it("round-trips through the instance cipher; the summary and the list carry no ciphertext and no secret", async () => {
    const created = await createHttpCredential(OWNER, { name: "Grok bot", headerName: "Authorization", secret: "Bearer crsr_123" })
    expect(created).toMatchObject({ name: "Grok bot", authKind: "header", headerName: "Authorization", boundUrl: null, boundMatch: "exact" })
    expect(JSON.stringify(created)).not.toContain("crsr_123")
    expect(JSON.stringify(created)).not.toContain("ciphertext")

    const stored = table[0]!
    expect(stored.ciphertext).not.toContain("crsr_123")
    expect(decryptSecret(stored.ciphertext as string)).toBe("Bearer crsr_123")

    const listed = await listHttpCredentials(OWNER)
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain("crsr_123")
    expect(Object.keys(listed[0]!)).not.toContain("ciphertext")
    // Scoped: a stranger's list is empty.
    expect(await listHttpCredentials(STRANGER)).toEqual([])
  })

  it("stores a bound credential normalised", async () => {
    const created = await createHttpCredential(OWNER, {
      name: "Locked",
      headerName: "X-API-Key",
      secret: "k",
      boundUrl: httpCredentialBoundUrlSchema.parse(`${HOOK}?x=1`),
      boundMatch: "prefix",
    })
    expect(created.boundUrl).toBe(HOOK)
    expect(created.boundMatch).toBe("prefix")
  })

  it("refuses a duplicate name per user and the per-user ceiling", async () => {
    await createHttpCredential(OWNER, { name: "Same", headerName: "X-A", secret: "1" })
    await expectCode(createHttpCredential(OWNER, { name: "Same", headerName: "X-A", secret: "2" }), "name_taken")
    // The same name is fine for someone else.
    await createHttpCredential(STRANGER, { name: "Same", headerName: "X-A", secret: "3" })

    for (let i = table.filter((r) => r.user_id === OWNER).length; i < MAX_HTTP_CREDENTIALS_PER_USER; i++) {
      await createHttpCredential(OWNER, { name: `n${i}`, headerName: "X-A", secret: "s" })
    }
    await expectCode(createHttpCredential(OWNER, { name: "one too many", headerName: "X-A", secret: "s" }), "limit_reached")
  })

  it("surfaces the missing instance key as EncryptionKeyMissingError, not as a stored row", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    await expect(createHttpCredential(OWNER, { name: "x", headerName: "X-A", secret: "s" })).rejects.toMatchObject({ name: "EncryptionKeyMissingError" })
    expect(table).toHaveLength(0)
  })
})

describe("validation — header name, secret, bound url", () => {
  it("header name: token characters only, and never the request's own framing", () => {
    expect(httpCredentialHeaderNameSchema.parse(" X-API-Key ")).toBe("X-API-Key")
    for (const bad of ["", "X API", "X-API-Key:", "a".repeat(65), "Host", "cookie ", "Content-Length", "transfer-encoding", "Set-Cookie"]) {
      expect(httpCredentialHeaderNameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("secret: printable ASCII on one line, bounded", () => {
    expect(httpCredentialSecretSchema.safeParse("Bearer crsr_abc.DEF-123 ~!").success).toBe(true)
    for (const bad of ["", "with\nnewline", "with\rreturn", "tab\there", "ünïcode", "x".repeat(4097)]) {
      expect(httpCredentialSecretSchema.safeParse(bad).success, JSON.stringify(bad.slice(0, 12))).toBe(false)
    }
  })

  it("bound url: https, public host, normalised; http / userinfo / private hosts refused", () => {
    expect(httpCredentialBoundUrlSchema.parse(" https://Api.Corp.com/hooks/x?run=1#f ")).toBe("https://api.corp.com/hooks/x")
    for (const bad of ["http://api.corp.com/hooks", "https://u:p@api.corp.com/hooks", "https://127.0.0.1/hooks", "https://localhost/hooks", "ftp://x", "nope"]) {
      expect(httpCredentialBoundUrlSchema.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe("update — the binding is a ratchet", () => {
  it("sets a binding on a plain credential, moves it on a bound one, refuses to clear it", async () => {
    const plain = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    const bound = await updateHttpCredential(OWNER, plain.id, { boundUrl: HOOK, boundMatch: "exact" })
    expect(bound.boundUrl).toBe(HOOK)

    const moved = await updateHttpCredential(OWNER, plain.id, { boundUrl: "https://api.corp.com/hooks", boundMatch: "prefix" })
    expect(moved).toMatchObject({ boundUrl: "https://api.corp.com/hooks", boundMatch: "prefix" })

    await expectCode(updateHttpCredential(OWNER, plain.id, { boundUrl: null }), "binding_required")
    expect(table[0]!.bound_url).toBe("https://api.corp.com/hooks")
  })

  it("refuses a prefix lock at the site root — a host-only lock does not exist", async () => {
    await expectCode(
      createHttpCredential(OWNER, { name: "root", headerName: "X-A", secret: "s", boundUrl: "https://api.corp.com/", boundMatch: "prefix" }),
      "prefix_needs_path",
    )
    const plain = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    await expectCode(updateHttpCredential(OWNER, plain.id, { boundUrl: "https://api.corp.com/", boundMatch: "prefix" }), "prefix_needs_path")
    // Widening an exact root lock to a prefix is the same host-only shape.
    await updateHttpCredential(OWNER, plain.id, { boundUrl: "https://api.corp.com/", boundMatch: "exact" })
    await expectCode(updateHttpCredential(OWNER, plain.id, { boundMatch: "prefix" }), "prefix_needs_path")
    // A path under the site is fine.
    const ok = await updateHttpCredential(OWNER, plain.id, { boundUrl: "https://api.corp.com/hooks", boundMatch: "prefix" })
    expect(ok.boundMatch).toBe("prefix")
  })

  it("rotates the secret in place, renames, and touches updated_at; a stranger cannot reach the row", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "old" })
    const before = table[0]!.updated_at
    await new Promise((r) => setTimeout(r, 2))
    const updated = await updateHttpCredential(OWNER, created.id, { secret: "new", name: "renamed", headerName: "X-B" })
    expect(updated).toMatchObject({ name: "renamed", headerName: "X-B" })
    expect(decryptSecret(table[0]!.ciphertext as string)).toBe("new")
    expect(table[0]!.updated_at).not.toBe(before)

    await expectCode(updateHttpCredential(STRANGER, created.id, { name: "stolen" }), "not_found")
    expect(table[0]!.name).toBe("renamed")
  })

  it("delete is scoped to the owner", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    expect(await deleteHttpCredential(STRANGER, created.id)).toBe(false)
    expect(table).toHaveLength(1)
    expect(await deleteHttpCredential(OWNER, created.id)).toBe(true)
    expect(table).toHaveLength(0)
    expect(await deleteHttpCredential(OWNER, created.id)).toBe(false)
  })
})

describe("resolveHttpAuthHeaders — the one decrypt site", () => {
  it("returns exactly the credential header for the owner's own run; a plain credential carries no binding", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "Authorization", secret: "Bearer crsr_1" })
    const resolved = await resolveHttpAuthHeaders(created.id, OWNER, HOOK, { ownerInitiated: true })
    expect(resolved).toEqual({ headers: { Authorization: "Bearer crsr_1" }, headerName: "Authorization", binding: null })
  })

  it("foreign and deleted read the same — one message, no uuid oracle", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    const foreign = await expectCode(resolveHttpAuthHeaders(created.id, STRANGER, HOOK, { ownerInitiated: true }), "not_found")
    await deleteHttpCredential(OWNER, created.id)
    const deleted = await expectCode(resolveHttpAuthHeaders(created.id, OWNER, HOOK, { ownerInitiated: true }), "not_found")
    expect(foreign.message).toBe(deleted.message)
    expect(foreign.message).not.toContain(created.id)
  })

  it("fails closed when no owner is resolvable (the ctx-less path)", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    await expectCode(resolveHttpAuthHeaders(created.id, undefined, HOOK, { ownerInitiated: true }), "no_owner")
  })

  it("a PLAIN credential does not resolve for a run that is not owner-initiated (D3); a BOUND one does", async () => {
    const plain = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    await expectCode(resolveHttpAuthHeaders(plain.id, OWNER, HOOK, { ownerInitiated: false }), "unbound_shared_run")

    const bound = await createHttpCredential(OWNER, { name: "b", headerName: "X-A", secret: "s", boundUrl: HOOK, boundMatch: "exact" })
    const resolved = await resolveHttpAuthHeaders(bound.id, OWNER, HOOK, { ownerInitiated: false })
    expect(resolved.binding).toEqual({ url: HOOK, match: "exact" })
    expect(resolved.headers).toEqual({ "X-A": "s" })
  })

  it("a BOUND credential refuses a destination outside its binding — before decrypting", async () => {
    const bound = await createHttpCredential(OWNER, { name: "b", headerName: "X-A", secret: "s", boundUrl: HOOK, boundMatch: "exact" })
    const err = await expectCode(
      resolveHttpAuthHeaders(bound.id, OWNER, "https://api2.cursor.sh/automations/webhook/OTHER", { ownerInitiated: true }),
      "destination_mismatch",
    )
    expect(err.message).not.toContain("OTHER")
    expect(err.message).not.toContain("cursor")
    await expectCode(resolveHttpAuthHeaders(bound.id, OWNER, "http://api2.cursor.sh/automations/webhook/abc", { ownerInitiated: true }), "destination_mismatch")
  })

  it("validates the ROW, not just the input — a malformed row never yields an empty header map", async () => {
    const created = await createHttpCredential(OWNER, { name: "p", headerName: "X-A", secret: "s" })
    table[0]!.config = {}
    await expectCode(resolveHttpAuthHeaders(created.id, OWNER, HOOK, { ownerInitiated: true }), "invalid_row")
    table[0]!.config = { headerName: "X-A" }
    table[0]!.auth_kind = "bearer-from-the-future"
    await expectCode(resolveHttpAuthHeaders(created.id, OWNER, HOOK, { ownerInitiated: true }), "invalid_row")
    table[0]!.auth_kind = "header"
    table[0]!.ciphertext = "bm90LWFuLWVudmVsb3Bl"
    const corrupt = await expectCode(resolveHttpAuthHeaders(created.id, OWNER, HOOK, { ownerInitiated: true }), "invalid_row")
    expect(corrupt.message).not.toContain("bm90")
  })
})

describe("findUnboundCredentialUses — the publish / share / save gate", () => {
  it("names the plain, missing and mismatched uses with the node's url; skips matching bound ones, url-less bound ones and other nodes", async () => {
    const plain = await createHttpCredential(OWNER, { name: "plain", headerName: "X-A", secret: "s" })
    const bound = await createHttpCredential(OWNER, { name: "bound", headerName: "X-A", secret: "s", boundUrl: HOOK, boundMatch: "exact" })
    const foreign = await createHttpCredential(STRANGER, { name: "theirs", headerName: "X-A", secret: "s" })
    const nodes = [
      { id: "h1", type: "webhook-output", data: { label: "Deliver", url: "https://mine.example/a", credentialId: plain.id } },
      { id: "h2", type: "webhook-output", data: { url: HOOK, credentialId: bound.id } },
      { id: "h3", type: "webhook-output", data: { url: "https://mine.example/c", credentialId: foreign.id } },
      { id: "h4", type: "webhook-output", data: { url: "https://mine.example/d" } },
      // Bound to HOOK, aimed elsewhere on the same host: would fail at send time.
      { id: "h5", type: "webhook-output", data: { label: "Aimed", url: "https://hooks.example.com/in/other", credentialId: bound.id } },
      // Bound, no URL yet (may arrive mapped at run time): not judged here.
      { id: "h6", type: "webhook-output", data: { url: "", credentialId: bound.id } },
      { id: "t1", type: "text-prompt", data: { credentialId: plain.id } },
    ]
    const uses = await findUnboundCredentialUses(nodes, OWNER)
    expect(uses).toEqual([
      { nodeId: "h1", nodeLabel: "Deliver", credentialId: plain.id, nodeUrl: "https://mine.example/a", kind: "plain", credentialName: "plain" },
      { nodeId: "h3", nodeLabel: "Webhook Output", credentialId: foreign.id, nodeUrl: "https://mine.example/c", kind: "missing", credentialName: null },
      { nodeId: "h5", nodeLabel: "Aimed", credentialId: bound.id, nodeUrl: "https://hooks.example.com/in/other", kind: "mismatch", credentialName: "bound" },
    ])
  })

  it("a node whose URL is mapped at run time is reported with an empty url and urlMapped, and a bound one is not judged", async () => {
    const plain = await createHttpCredential(OWNER, { name: "plain-m", headerName: "X-A", secret: "s" })
    const bound = await createHttpCredential(OWNER, { name: "bound-m", headerName: "X-A", secret: "s", boundUrl: HOOK, boundMatch: "exact" })
    const nodes = [
      // Stored field mapping on the node itself.
      { id: "m1", type: "webhook-output", data: { url: "https://stale.example/a", credentialId: plain.id, fieldMappings: { url: { sourceNodeId: "t1" } } } },
      // A live edge into the `field-url` handle.
      { id: "m2", type: "webhook-output", data: { url: "https://stale.example/b", credentialId: bound.id } },
      // Static, and aimed elsewhere: still a mismatch.
      { id: "m3", type: "webhook-output", data: { url: "https://stale.example/c", credentialId: bound.id } },
      // The `{}` placeholder — the one form the editor's URL field can type.
      { id: "m4", type: "webhook-output", data: { url: "https://hooks.example.com/{}", credentialId: bound.id } },
      { id: "m5", type: "webhook-output", data: { url: "https://hooks.example.com/in/{}", credentialId: plain.id } },
      { id: "t1", type: "text-prompt", data: {} },
    ]
    const edges = [{ source: "t1", target: "m2", targetHandle: "field-url" }, { source: "t1", target: "m3", targetHandle: "in" }]
    const uses = await findUnboundCredentialUses(nodes, OWNER, edges)
    expect(uses).toEqual([
      { nodeId: "m1", nodeLabel: "Webhook Output", credentialId: plain.id, nodeUrl: "", kind: "plain", credentialName: "plain-m", urlMapped: true },
      { nodeId: "m3", nodeLabel: "Webhook Output", credentialId: bound.id, nodeUrl: "https://stale.example/c", kind: "mismatch", credentialName: "bound-m" },
      { nodeId: "m5", nodeLabel: "Webhook Output", credentialId: plain.id, nodeUrl: "", kind: "plain", credentialName: "plain-m", urlMapped: true },
    ])
  })

  it("is empty when no webhook carries a credential — and never queries", async () => {
    expect(await findUnboundCredentialUses([{ id: "t1", type: "text-prompt", data: {} }], OWNER)).toEqual([])
    expect(await findUnboundCredentialUses(undefined, OWNER)).toEqual([])
  })
})
