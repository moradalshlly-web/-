/**
 * Where a stored HTTP credential may travel (plan D5 / D6).
 *
 * A BOUND credential names one https destination and how strictly the node's
 * URL has to match it:
 *   - `exact`  — same origin and the same path (`origin + pathname` after
 *                `new URL()` normalisation, which resolves `..` segments and
 *                drops userinfo, so `https://api.corp.com@attacker/` is host
 *                `attacker` and fails the origin test);
 *   - `prefix` — same origin and a path UNDER the bound one at a segment
 *                boundary (`/hooks` covers `/hooks/x`, not `/hooksbad`).
 * Query strings and fragments are never part of the binding. Host-only
 * binding does not exist: same-host aiming (`/hooks/x` → `/v1/admin/users`)
 * is exactly the move it has to refuse.
 *
 * Pure — no I/O — because BOTH sides call it: the resolver before it decrypts,
 * and `safeFetch` on every redirect hop (a redirect out of the binding is not
 * followed; the request is never re-sent bare).
 */

export type CredentialBoundMatch = "exact" | "prefix"

export interface CredentialBinding {
  readonly url: string
  readonly match: CredentialBoundMatch
}

/** `https://` only, a real hostname, no userinfo, no fragment — what a binding may name. */
export function normalizeBindingUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") return null
  if (!parsed.hostname) return null
  if (parsed.username || parsed.password) return null
  parsed.hash = ""
  parsed.search = ""
  return parsed.toString()
}

function pathUnder(pathname: string, boundPath: string): boolean {
  if (pathname === boundPath) return true
  const base = boundPath.endsWith("/") ? boundPath : `${boundPath}/`
  return pathname.startsWith(base)
}

/**
 * True when `targetUrl` is a destination the binding allows. Anything that is
 * not an https URL is refused outright — a credential never rides plain http.
 */
export function matchesCredentialBinding(targetUrl: string, binding: CredentialBinding): boolean {
  let target: URL
  let bound: URL
  try {
    target = new URL(targetUrl)
    bound = new URL(binding.url)
  } catch {
    return false
  }
  if (target.protocol !== "https:" || bound.protocol !== "https:") return false
  if (target.username || target.password) return false
  if (target.origin !== bound.origin) return false
  // An encoded separator survives URL normalisation (`/hooks/..%2f..%2fadmin`
  // keeps its pathname) but a decode-then-route server lands elsewhere — the
  // one shape the string comparison below cannot see, so it is refused; so is
  // `%25`, which is the same separator one decode further out (`%252f`). A
  // path with a literal percent sign (`/100%25off`) can therefore never be a
  // credentialed destination — accepted: a key must not ride on a guess.
  if (/%2f|%5c|%25/i.test(target.pathname)) return false
  if (binding.match === "exact") return target.pathname === bound.pathname
  // A prefix at the site root would be a host-only lock, which does not exist
  // (same-host aiming is what a binding refuses). Never a match.
  if (bound.pathname === "/") return false
  return pathUnder(target.pathname, bound.pathname)
}
