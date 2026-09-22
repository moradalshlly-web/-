import { describe, expect, it } from "vitest"
import { matchesCredentialBinding, normalizeBindingUrl } from "../credential-binding.js"

describe("normalizeBindingUrl", () => {
  it("keeps origin + path, drops query and fragment, requires https and a bare host", () => {
    expect(normalizeBindingUrl(" https://hooks.example.com/in/abc?x=1#frag ")).toBe(
      "https://hooks.example.com/in/abc",
    )
    expect(normalizeBindingUrl("http://api2.cursor.sh/hook")).toBeNull()
    expect(normalizeBindingUrl("https://user:pw@api2.cursor.sh/hook")).toBeNull()
    expect(normalizeBindingUrl("not a url")).toBeNull()
    expect(normalizeBindingUrl("https://")).toBeNull()
  })
})

describe("matchesCredentialBinding — where a key may travel", () => {
  const exact = { url: "https://api.corp.com/hooks/x", match: "exact" as const }
  const prefix = { url: "https://api.corp.com/hooks", match: "prefix" as const }

  it("exact: same origin and the same path; query and fragment do not matter", () => {
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x", exact)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x?run=7#top", exact)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x/", exact)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/y", exact)).toBe(false)
  })

  it("refuses same-host aiming — a different path on the bound origin is outside an exact binding", () => {
    // Audit revision item 3: `/hooks/x` → `/v1/admin/users` authenticates on a host-only lock.
    expect(matchesCredentialBinding("https://api.corp.com/v1/admin/users", exact)).toBe(false)
  })

  it("prefix: same origin and a path under the bound one at a segment boundary", () => {
    expect(matchesCredentialBinding("https://api.corp.com/hooks", prefix)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/", prefix)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/a/b", prefix)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com/hooksbad", prefix)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/v1/admin", prefix)).toBe(false)
  })

  it("normalises before comparing: dot segments and userinfo cannot escape the binding", () => {
    // `new URL()` resolves `..`, so this is `/v1/admin/users` — outside.
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x/../../v1/admin/users", prefix)).toBe(false)
    // …and `/hooks/a/../b` is `/hooks/b` — inside the prefix.
    expect(matchesCredentialBinding("https://api.corp.com/hooks/a/../b", prefix)).toBe(true)
    // Userinfo: the host is `attacker`, and userinfo on the target is refused outright.
    expect(matchesCredentialBinding("https://api.corp.com@attacker.example/hooks/x", exact)).toBe(false)
    expect(matchesCredentialBinding("https://u:p@api.corp.com/hooks/x", exact)).toBe(false)
  })

  it("origin means scheme + host + port; case of the host does not matter", () => {
    expect(matchesCredentialBinding("https://API.CORP.COM/hooks/x", exact)).toBe(true)
    expect(matchesCredentialBinding("https://api.corp.com:8443/hooks/x", exact)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com.attacker.example/hooks/x", exact)).toBe(false)
    expect(matchesCredentialBinding("https://attacker.example/hooks/x", prefix)).toBe(false)
  })

  it("an encoded separator in the target path never matches — a decode-then-route server would land elsewhere", () => {
    expect(matchesCredentialBinding("https://api.corp.com/hooks/..%2f..%2fadmin", prefix)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x%2F..%2Fadmin", exact)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/a%5c..%5cadmin", prefix)).toBe(false)
    // Double-encoded: one decode gives `%2f`, the next gives `/`.
    expect(matchesCredentialBinding("https://api.corp.com/hooks/..%252f..%252fadmin", prefix)).toBe(false)
    // Ordinary percent-encoding elsewhere is not a separator.
    expect(matchesCredentialBinding("https://api.corp.com/hooks/a%20b", prefix)).toBe(true)
  })

  it("a prefix bound at the site root is a host-only lock, which does not exist — never a match", () => {
    const root = { url: "https://api.corp.com/", match: "prefix" as const }
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x", root)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/", root)).toBe(false)
    // An EXACT root lock is a real address and still works.
    expect(matchesCredentialBinding("https://api.corp.com/", { url: "https://api.corp.com/", match: "exact" })).toBe(true)
  })

  it("a credential never rides plain http, and garbage never matches", () => {
    expect(matchesCredentialBinding("http://api.corp.com/hooks/x", exact)).toBe(false)
    expect(matchesCredentialBinding("not a url", exact)).toBe(false)
    expect(matchesCredentialBinding("https://api.corp.com/hooks/x", { url: "http://api.corp.com/hooks/x", match: "exact" })).toBe(false)
  })
})
