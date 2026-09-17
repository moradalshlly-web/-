/**
 * Lenient web-address input. People type what they see in the address bar
 * — `pletor.ai`, `www.pletor.ai/products`, `//cdn.example.com/x` — and a
 * strict `z.string().url()` rejected every one of those with "Invalid URL"
 * before the scraper ever ran. This adds the missing scheme so any of the
 * usual spellings resolve; the strict schema still runs afterwards, so an
 * address that is not a URL at all is still refused.
 *
 * Only the scheme is inferred. The host, path and query are passed through
 * untouched, and a value that already carries a scheme (http, https, or any
 * other) is returned as typed — the schema decides whether that scheme is
 * acceptable.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export function normalizeWebUrlInput(value: unknown): unknown {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (trimmed === "") return trimmed
  if (HAS_SCHEME.test(trimmed)) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  return `https://${trimmed}`
}
