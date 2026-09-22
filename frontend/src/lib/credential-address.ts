/**
 * The client-side twin of the server's binding predicate
 * (`backend/src/lib/credential-binding.ts`): a credential lock is ORIGIN +
 * PATH — query and fragment are not part of it, hosts are case-insensitive,
 * a default port folds away — and the server stores the lock in that
 * normalised form. So the UI must never compare a node URL to a lock as raw
 * strings: `https://hooks.example.com/in?token=abc` IS the locked address
 * `https://hooks.example.com/in`, and "fixing" it to the lock would drop the
 * token. Used for hints and grouping only; the server decides at send time.
 */

/**
 * `origin + pathname` of an https URL, or `null` when the server would refuse
 * it outright — not https, userinfo in the URL, an encoded separator in the
 * path. A `null` never equals anything, so the panel warns and the dialog does
 * not fold such a node into a lock.
 */
export function bindingAddressKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "https:") return null
    if (parsed.username || parsed.password) return null
    if (/%2f|%5c|%25/i.test(parsed.pathname)) return null
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return null
  }
}

/** Same address as far as a binding is concerned. Two unparsable URLs are never "the same". */
export function sameBindingAddress(a: string, b: string): boolean {
  const keyA = bindingAddressKey(a)
  return keyA !== null && keyA === bindingAddressKey(b)
}
