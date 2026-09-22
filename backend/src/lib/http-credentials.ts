/**
 * Stored HTTP credentials for authenticated outbound webhooks (Webhook Output).
 *
 * The secret never enters workflow JSON: the node holds `credentialId`, this
 * module holds the row (migration 435, service-role only) and is the ONLY
 * place in the codebase that decrypts an `http_credentials` ciphertext —
 * `resolveHttpAuthHeaders`, at send time, for one request.
 *
 * Two kinds of credential, one table (plan D1–D4):
 *   - PLAIN — no destination. Fine while only the workflow's owner can run the
 *     workflow. A run the owner did not start (a published app, share-for-run,
 *     a collaborator) is refused: the runner supplies the override map and the
 *     upstream text, so an unbound key would be theirs to aim.
 *   - BOUND — `bound_url` + `bound_match` (`credential-binding.ts`). The key
 *     travels only to that destination, checked here before decryption and
 *     again by `safeFetch` on every redirect hop.
 * Binding is a ratchet: a PATCH may set it or move it, never clear it.
 *
 * Identity is an ARGUMENT, never read from a context: the caller says whose
 * credential may resolve (the workflow OWNER — `ctx.workflowOwnerId` in the
 * orchestrator, the named workflow's row in the single-node route) and whether
 * the runner IS that owner. No owner resolvable → refuse (fail closed).
 */

import { z } from "zod"
import { supabase } from "./supabase.js"
import { decryptSecret, encryptSecret } from "./instance-cipher.js"
import { safeUrlSchema } from "./url-validator.js"
import {
  matchesCredentialBinding,
  normalizeBindingUrl,
  type CredentialBinding,
  type CredentialBoundMatch,
} from "./credential-binding.js"

export const HTTP_CREDENTIAL_AUTH_KINDS = ["header"] as const
export type HttpCredentialAuthKind = (typeof HTTP_CREDENTIAL_AUTH_KINDS)[number]
export const HTTP_CREDENTIAL_MATCHES = ["exact", "prefix"] as const satisfies readonly CredentialBoundMatch[]
/** Per-user ceiling — a credential list, not a key-value store. */
export const MAX_HTTP_CREDENTIALS_PER_USER = 50

// ---------------------------------------------------------------------------
// Validation — applied at create/patch AND to every row on read (a row written
// before a rule changed is re-checked; an unknown kind never sends bare).
// ---------------------------------------------------------------------------

/** RFC 7230 token subset; the same check runs at send, not only at create. */
const HEADER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
/**
 * Names a credential may not set: the request's own framing (undici would
 * reject some, silently override others) and the two cookie headers.
 */
const BLOCKED_HEADER_NAMES: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "cookie",
  "set-cookie",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
])
/** Printable ASCII, no CR / LF — a value undici would refuse would otherwise put the secret into an error string. */
const SECRET_RE = /^[\x20-\x7E]+$/

export const httpCredentialNameSchema = z.string().trim().min(1).max(80)

export const httpCredentialHeaderNameSchema = z
  .string()
  .trim()
  .regex(HEADER_NAME_RE, "Header name must be letters, digits and dashes (max 64)")
  .refine((name) => !BLOCKED_HEADER_NAMES.has(name.toLowerCase()), {
    message: "This header is set by the request itself and cannot carry a credential",
  })

export const httpCredentialSecretSchema = z
  .string()
  .min(1, "Secret is required")
  .max(4096, "Secret is too long")
  .regex(SECRET_RE, "Secret must be printable ASCII on a single line")

export const httpCredentialBoundMatchSchema = z.enum(HTTP_CREDENTIAL_MATCHES)

/** An https destination with a real, public hostname — normalised (no query, no fragment). */
export const httpCredentialBoundUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((raw, ctx) => {
    const normalized = normalizeBindingUrl(raw)
    if (!normalized || !safeUrlSchema.safeParse(normalized).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The address must be an https URL to a public host (no username, no fragment)",
      })
      return z.NEVER
    }
    return normalized
  })

const summaryRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  auth_kind: z.enum(HTTP_CREDENTIAL_AUTH_KINDS),
  config: z.object({ headerName: httpCredentialHeaderNameSchema }).passthrough(),
  bound_url: z.string().nullable(),
  bound_match: httpCredentialBoundMatchSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

const fullRowSchema = summaryRowSchema.extend({
  user_id: z.string().uuid(),
  ciphertext: z.string().min(1),
})

/** What a list or a write returns — never the ciphertext, and there is no "reveal". */
const SUMMARY_COLUMNS = "id, name, auth_kind, config, bound_url, bound_match, created_at, updated_at"
const FULL_COLUMNS = `${SUMMARY_COLUMNS}, user_id, ciphertext`

export interface HttpCredentialSummary {
  readonly id: string
  readonly name: string
  readonly authKind: HttpCredentialAuthKind
  readonly headerName: string
  /** `null` = plain credential. */
  readonly boundUrl: string | null
  readonly boundMatch: CredentialBoundMatch
  readonly createdAt: string
  readonly updatedAt: string
}

function toSummary(row: z.infer<typeof summaryRowSchema>): HttpCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    authKind: row.auth_kind,
    headerName: row.config.headerName,
    boundUrl: row.bound_url,
    boundMatch: row.bound_match,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Errors — fixed strings. None carries a secret, a URL or a row value.
// ---------------------------------------------------------------------------

export type HttpCredentialErrorCode =
  | "not_found"
  | "no_owner"
  | "unbound_shared_run"
  | "destination_mismatch"
  | "invalid_row"
  | "binding_required"
  | "limit_reached"
  | "name_taken"
  | "prefix_needs_path"

const ERROR_MESSAGES: Record<HttpCredentialErrorCode, string> = {
  // ONE message for "deleted" and "someone else's" — two would confirm a uuid exists.
  not_found:
    "This webhook's credential is not available: it was removed or belongs to another account. Pick a credential again in the node's settings.",
  no_owner: "This webhook uses a stored credential, but the run has no workflow owner to resolve it for.",
  unbound_shared_run:
    "This webhook's credential is not locked to an address. Lock it in Integrations before other people run this workflow.",
  destination_mismatch: "The webhook URL is outside the address this credential is locked to.",
  invalid_row: "This webhook's credential is malformed and was not sent. Save it again in Integrations.",
  binding_required: "A locked credential stays locked: change the address, or delete the credential and create a new one.",
  limit_reached: `You can keep up to ${MAX_HTTP_CREDENTIALS_PER_USER} credentials. Delete one to add another.`,
  name_taken: "You already have a credential with this name.",
  prefix_needs_path:
    "A prefix lock needs a path: lock an exact address, or a path under the site — a whole site is never a lock.",
}

/**
 * A `prefix` binding at the site root would be a host-only lock — the one
 * shape the plan rules out (same-host aiming). Refused at write time here and
 * treated as no-match by `matchesCredentialBinding`, so a row written another
 * way still cannot send.
 */
function assertPrefixHasPath(boundUrl: string | null | undefined, boundMatch: CredentialBoundMatch | undefined): void {
  if (!boundUrl || boundMatch !== "prefix") return
  let pathname: string
  try {
    pathname = new URL(boundUrl).pathname
  } catch {
    // Only a stored value reaches here unparsed (input is Zod-validated): a
    // corrupt row is a typed 400, not a raw TypeError.
    throw new HttpCredentialError("invalid_row")
  }
  if (pathname === "/") throw new HttpCredentialError("prefix_needs_path")
}

export class HttpCredentialError extends Error {
  readonly code: HttpCredentialErrorCode

  constructor(code: HttpCredentialErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = "HttpCredentialError"
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// CRUD — every function takes the identity as its first argument and scopes
// the query by it; RLS-with-no-policies means a missing `.eq("user_id")` is a
// straight IDOR, so the guard test holds every query to it.
// ---------------------------------------------------------------------------

export interface CreateHttpCredentialInput {
  readonly name: string
  readonly headerName: string
  readonly secret: string
  readonly boundUrl?: string | null
  readonly boundMatch?: CredentialBoundMatch
}

export interface UpdateHttpCredentialInput {
  readonly name?: string
  readonly headerName?: string
  readonly secret?: string
  /** Set or move the binding. `null` (clearing it) is refused — the binding is a ratchet. */
  readonly boundUrl?: string | null
  readonly boundMatch?: CredentialBoundMatch
}

export async function listHttpCredentials(userId: string): Promise<HttpCredentialSummary[]> {
  const { data, error } = await supabase
    .from("http_credentials")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`Failed to list credentials: ${error.message}`)
  const out: HttpCredentialSummary[] = []
  for (const raw of data ?? []) {
    const parsed = summaryRowSchema.safeParse(raw)
    // A row that no longer parses is not listed rather than crashing the list;
    // resolution refuses it too (`invalid_row`), so it cannot be USED either.
    if (parsed.success) out.push(toSummary(parsed.data))
  }
  return out
}

export async function createHttpCredential(
  userId: string,
  input: CreateHttpCredentialInput,
): Promise<HttpCredentialSummary> {
  const { count, error: countError } = await supabase
    .from("http_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
  if (countError) throw new Error(`Failed to count credentials: ${countError.message}`)
  if ((count ?? 0) >= MAX_HTTP_CREDENTIALS_PER_USER) throw new HttpCredentialError("limit_reached")

  const boundUrl = input.boundUrl ?? null
  assertPrefixHasPath(boundUrl, input.boundMatch ?? "exact")
  // EncryptionKeyMissingError propagates as-is: the route answers 503 with its
  // operator-actionable message.
  const ciphertext = encryptSecret(input.secret)
  const { data, error } = await supabase
    .from("http_credentials")
    .insert({
      user_id: userId,
      name: input.name,
      auth_kind: "header",
      config: { headerName: input.headerName },
      ciphertext,
      bound_url: boundUrl,
      bound_match: input.boundMatch ?? "exact",
    })
    .select(SUMMARY_COLUMNS)
    .single()
  if (error) {
    if (error.code === "23505") throw new HttpCredentialError("name_taken")
    throw new Error(`Failed to create credential: ${error.message}`)
  }
  return toSummary(summaryRowSchema.parse(data))
}

export async function updateHttpCredential(
  userId: string,
  credentialId: string,
  patch: UpdateHttpCredentialInput,
): Promise<HttpCredentialSummary> {
  const { data: existing, error: loadError } = await supabase
    .from("http_credentials")
    .select(SUMMARY_COLUMNS)
    .eq("id", credentialId)
    .eq("user_id", userId)
    .maybeSingle()
  if (loadError) throw new Error(`Failed to load credential: ${loadError.message}`)
  if (!existing) throw new HttpCredentialError("not_found")
  const parsedExisting = summaryRowSchema.safeParse(existing)
  if (!parsedExisting.success) throw new HttpCredentialError("invalid_row")
  const current = parsedExisting.data

  // The ratchet, precisely: a binding can be SET on a plain row and MOVED on a
  // bound row (a different address, exact ↔ prefix), but never CLEARED — a
  // shared workflow that relies on it must not silently go plain.
  if (patch.boundUrl === null && current.bound_url !== null) throw new HttpCredentialError("binding_required")
  assertPrefixHasPath(patch.boundUrl ?? current.bound_url, patch.boundMatch ?? current.bound_match)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.headerName !== undefined) updates.config = { ...current.config, headerName: patch.headerName }
  if (patch.secret !== undefined) updates.ciphertext = encryptSecret(patch.secret)
  if (patch.boundUrl !== undefined && patch.boundUrl !== null) updates.bound_url = patch.boundUrl
  if (patch.boundMatch !== undefined) updates.bound_match = patch.boundMatch

  const { data, error } = await supabase
    .from("http_credentials")
    .update(updates)
    .eq("id", credentialId)
    .eq("user_id", userId)
    .select(SUMMARY_COLUMNS)
    .single()
  if (error) {
    if (error.code === "23505") throw new HttpCredentialError("name_taken")
    throw new Error(`Failed to update credential: ${error.message}`)
  }
  return toSummary(summaryRowSchema.parse(data))
}

/** True when a row was deleted; false when none matched (someone else's, or already gone). */
export async function deleteHttpCredential(userId: string, credentialId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("http_credentials")
    .delete()
    .eq("id", credentialId)
    .eq("user_id", userId)
    .select("id")
  if (error) throw new Error(`Failed to delete credential: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Resolution — the one decrypt site.
// ---------------------------------------------------------------------------

export interface ResolvedHttpAuth {
  /** Exactly the header(s) to attach — pass to `safeFetch` as `credentialHeaders`, never as `headers`. */
  readonly headers: Record<string, string>
  readonly headerName: string
  /** `null` for a plain credential; otherwise what `safeFetch` must hold every hop to. */
  readonly binding: CredentialBinding | null
}

export interface ResolveHttpAuthOptions {
  /**
   * Whether the workflow's OWNER started this run themselves, from the app,
   * with no external input able to reach the graph (the editor's own
   * browser-session run, the owner's own schedule). Decided by the caller at
   * enqueue — never from "runner id equals owner id", which is also true for
   * an OAuth / API token and for a public webhook trigger. A plain credential
   * resolves only when true (plan D3); a bound one resolves either way,
   * because the binding — not the identity — decides where it may go.
   */
  readonly ownerInitiated: boolean
}

/**
 * Decrypt the credential `credentialId` of `ownerId` for a request to
 * `targetUrl`. Throws `HttpCredentialError` — never returns partial headers
 * and never returns `{}`: a caller that gets a value may send; a caller that
 * does not must fail the node.
 */
export async function resolveHttpAuthHeaders(
  credentialId: string,
  ownerId: string | undefined,
  targetUrl: string,
  opts: ResolveHttpAuthOptions,
): Promise<ResolvedHttpAuth> {
  if (!ownerId) throw new HttpCredentialError("no_owner")

  const { data, error } = await supabase
    .from("http_credentials")
    .select(FULL_COLUMNS)
    .eq("id", credentialId)
    .eq("user_id", ownerId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load credential: ${error.message}`)
  if (!data) throw new HttpCredentialError("not_found")

  const parsed = fullRowSchema.safeParse(data)
  if (!parsed.success) throw new HttpCredentialError("invalid_row")
  const row = parsed.data

  const binding: CredentialBinding | null = row.bound_url ? { url: row.bound_url, match: row.bound_match } : null
  if (!binding && !opts.ownerInitiated) throw new HttpCredentialError("unbound_shared_run")
  if (binding && !matchesCredentialBinding(targetUrl, binding)) throw new HttpCredentialError("destination_mismatch")

  // `auth_kind` is a Zod enum with one member today; a second kind adds a case
  // here and NOTHING falls through to an empty header map.
  let secret: string
  try {
    secret = decryptSecret(row.ciphertext)
  } catch (err) {
    // A wrong instance key (a restore without the key) or a corrupt envelope:
    // the operator-actionable message is `EncryptionKeyMissingError`'s own;
    // anything else must not carry the envelope into an error string.
    if (err instanceof Error && err.name === "EncryptionKeyMissingError") throw err
    throw new HttpCredentialError("invalid_row")
  }
  if (!SECRET_RE.test(secret)) throw new HttpCredentialError("invalid_row")

  switch (row.auth_kind) {
    case "header":
      return { headers: { [row.config.headerName]: secret }, headerName: row.config.headerName, binding }
  }
}

// ---------------------------------------------------------------------------
// The publish / share / save gate (plan D3): which nodes still reference a
// credential that may not travel with strangers.
// ---------------------------------------------------------------------------

export interface UnboundCredentialUse {
  readonly nodeId: string
  readonly nodeLabel: string
  readonly credentialId: string
  /** The node's current URL — what the one-click lock offers to bind to. */
  readonly nodeUrl: string
  /**
   * `plain`: exists, no binding. `missing`: not the owner's, or gone.
   * `mismatch`: bound, but the node's URL is not under the binding — it would
   * fail at send time exactly like a plain one on a stranger's run.
   */
  readonly kind: "plain" | "missing" | "mismatch"
  readonly credentialName: string | null
  /**
   * The node's URL arrives from another node at run time (a field mapping),
   * so `nodeUrl` is empty here: there is no static address to judge a lock
   * against or to offer the one-click lock for.
   */
  readonly urlMapped?: true
}

/** The edge shape the gate needs: a live edge into the `field-url` handle maps the URL. */
export interface GraphEdgeLike {
  readonly source?: unknown
  readonly target?: unknown
  readonly targetHandle?: unknown
}

/**
 * Nodes whose `url` is supplied at run time — the three forms the resolver
 * honours (`packages/shared/src/resolve-field-mappings.ts`): a live edge into
 * `field-url`, a stored field mapping, and the `{}` placeholder typed into the
 * URL itself (the one form the editor's plain URL field can produce).
 */
export function nodesWithMappedUrl(
  nodes: ReadonlyArray<GraphNodeLike> | null | undefined,
  edges: ReadonlyArray<GraphEdgeLike> | null | undefined,
): ReadonlySet<string> {
  const mapped = new Set<string>()
  for (const edge of edges ?? []) {
    if (edge.targetHandle === "field-url" && typeof edge.target === "string") mapped.add(edge.target)
  }
  for (const node of nodes ?? []) {
    const fm = node.data?.fieldMappings as Record<string, { sourceNodeId?: unknown } | undefined> | undefined
    if (typeof fm?.url?.sourceNodeId === "string" && fm.url.sourceNodeId) mapped.add(node.id)
    if (typeof node.data?.url === "string" && node.data.url.includes("{}")) mapped.add(node.id)
  }
  return mapped
}

interface GraphNodeLike {
  readonly id: string
  readonly type?: string
  readonly data?: Record<string, unknown>
}

/** Webhook Output nodes carrying a `credentialId`, with the id — the cheap pre-filter every caller runs first. */
export function credentialedWebhookNodes(
  nodes: ReadonlyArray<GraphNodeLike> | null | undefined,
): Array<{ node: GraphNodeLike; credentialId: string }> {
  const out: Array<{ node: GraphNodeLike; credentialId: string }> = []
  for (const node of nodes ?? []) {
    if (!node || node.type !== "webhook-output") continue
    const credentialId = node.data?.credentialId
    if (typeof credentialId === "string" && credentialId.trim()) out.push({ node, credentialId: credentialId.trim() })
  }
  return out
}

/**
 * Every Webhook Output in `nodes` whose credential is PLAIN or MISSING for
 * `ownerId`. Empty means the graph may be shared with strangers as far as
 * credentials go. Scoped to the owner: a collaborator's own credential on the
 * owner's graph is `missing` here, which is also what resolution would say.
 */
export async function findUnboundCredentialUses(
  nodes: ReadonlyArray<GraphNodeLike> | null | undefined,
  ownerId: string,
  edges?: ReadonlyArray<GraphEdgeLike> | null,
): Promise<UnboundCredentialUse[]> {
  const uses = credentialedWebhookNodes(nodes)
  if (uses.length === 0) return []
  const mappedUrl = nodesWithMappedUrl(nodes, edges)
  const ids = [...new Set(uses.map((u) => u.credentialId))]
  const { data, error } = await supabase
    .from("http_credentials")
    .select(SUMMARY_COLUMNS)
    .in("id", ids)
    .eq("user_id", ownerId)
  if (error) throw new Error(`Failed to load credentials: ${error.message}`)
  const byId = new Map<string, z.infer<typeof summaryRowSchema>>()
  for (const raw of data ?? []) {
    const parsed = summaryRowSchema.safeParse(raw)
    if (parsed.success) byId.set(parsed.data.id, parsed.data)
  }
  const out: UnboundCredentialUse[] = []
  for (const { node, credentialId } of uses) {
    const row = byId.get(credentialId)
    const urlMapped = mappedUrl.has(node.id)
    // A mapped URL is decided at run time by the resolver; the static value is
    // stale by definition and must neither be judged nor offered as a lock.
    const nodeUrl = !urlMapped && typeof node.data?.url === "string" ? node.data.url : ""
    const kind = kindOfUse(row, nodeUrl)
    if (!kind) continue
    out.push({
      nodeId: node.id,
      nodeLabel: typeof node.data?.label === "string" && node.data.label ? node.data.label : "Webhook Output",
      credentialId,
      nodeUrl,
      kind,
      credentialName: row?.name ?? null,
      ...(urlMapped ? { urlMapped: true as const } : {}),
    })
  }
  return out
}

/**
 * Why a use cannot go in front of strangers, or `null` when it can. A bound
 * credential with an EMPTY node URL is not judged here — the URL may arrive
 * mapped at run time, where the resolver decides with the real value.
 */
function kindOfUse(
  row: z.infer<typeof summaryRowSchema> | undefined,
  nodeUrl: string,
): UnboundCredentialUse["kind"] | null {
  if (!row) return "missing"
  if (!row.bound_url) return "plain"
  const target = nodeUrl.trim()
  if (!target) return null
  return matchesCredentialBinding(target, { url: row.bound_url, match: row.bound_match }) ? null : "mismatch"
}
