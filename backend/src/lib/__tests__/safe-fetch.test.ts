import { describe, it, expect } from "vitest"
import { isPrivateOrReservedIP, safeFetch, filterSafeResolvedAddresses, assertSafeRedirectTarget } from "../safe-fetch.js"

// ---------------------------------------------------------------------------
// IP classifier — exercises the raw blocklist. The runtime path (DNS-lookup
// rejection via undici Agent.connect.lookup) isn't unit-tested because it
// requires coupling to undici internals; it's exercised via integration
// behaviour (safeFetch rejects literal private IPs at the fast-fail gate,
// which shares the same classifier).
// ---------------------------------------------------------------------------

describe("isPrivateOrReservedIP", () => {
  it("blocks IPv4 loopback, private, link-local, metadata, CGN, benchmarking, multicast, reserved", () => {
    expect(isPrivateOrReservedIP("127.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("127.255.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("10.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("172.15.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("172.16.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("172.31.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("172.32.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("192.168.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("169.254.1.1")).toBe(true)
    expect(isPrivateOrReservedIP("169.254.169.254")).toBe(true) // AWS/GCP metadata
    expect(isPrivateOrReservedIP("0.0.0.0")).toBe(true)
    expect(isPrivateOrReservedIP("0.1.2.3")).toBe(true)
    expect(isPrivateOrReservedIP("100.64.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("100.127.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("100.63.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("198.18.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("198.20.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("224.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("239.255.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("255.255.255.255")).toBe(true)
  })

  it("accepts public IPv4 addresses", () => {
    expect(isPrivateOrReservedIP("8.8.8.8")).toBe(false)
    expect(isPrivateOrReservedIP("1.1.1.1")).toBe(false)
    expect(isPrivateOrReservedIP("140.82.114.4")).toBe(false) // github.com
  })

  it("blocks IPv6 loopback, unspecified, link-local, ULA, multicast", () => {
    expect(isPrivateOrReservedIP("::1")).toBe(true)
    expect(isPrivateOrReservedIP("::")).toBe(true)
    expect(isPrivateOrReservedIP("fe80::1")).toBe(true)
    expect(isPrivateOrReservedIP("fc00::1")).toBe(true)
    expect(isPrivateOrReservedIP("fd12:3456:789a::1")).toBe(true)
    expect(isPrivateOrReservedIP("ff02::1")).toBe(true)
  })

  it("blocks IPv4-mapped IPv6 in both dotted and normalised hex forms", () => {
    // Dotted form — straight lookup of embedded IPv4.
    expect(isPrivateOrReservedIP("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("::ffff:169.254.169.254")).toBe(true)
    expect(isPrivateOrReservedIP("::ffff:10.0.0.1")).toBe(true)
    // WHATWG URL parser normalises the dotted tail into hex quads, e.g.
    // 127.0.0.1 → 7f00:0001 → written as 7f00:1. Must still block.
    expect(isPrivateOrReservedIP("::ffff:7f00:1")).toBe(true)       // 127.0.0.1
    expect(isPrivateOrReservedIP("::ffff:a9fe:a9fe")).toBe(true)    // 169.254.169.254
    expect(isPrivateOrReservedIP("::ffff:a00:1")).toBe(true)        // 10.0.0.1
    expect(isPrivateOrReservedIP("::ffff:c0a8:1")).toBe(true)       // 192.168.0.1
  })

  it("blocks IPv4-compatible IPv6 (::/96) in both dotted and normalised hex forms", () => {
    // Deprecated ::/96 — WHATWG presents ::127.0.0.1 as ::7f00:1 (hex quads).
    // The dotted-only branch used to miss the canonical hex form (fail-open).
    expect(isPrivateOrReservedIP("::127.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("::7f00:1")).toBe(true)            // 127.0.0.1
    expect(isPrivateOrReservedIP("::a9fe:a9fe")).toBe(true)         // 169.254.169.254
    expect(isPrivateOrReservedIP("::a00:1")).toBe(true)            // 10.0.0.1
  })

  it("accepts public IPv6 addresses", () => {
    expect(isPrivateOrReservedIP("2606:4700:4700::1111")).toBe(false) // cloudflare DNS
  })
})

describe("filterSafeResolvedAddresses", () => {
  // Orders IPv4 before IPv6 so undici's connector tries IPv4 first — Railway's
  // egress is IPv4-only, and a dual-stack answer with IPv6 first would otherwise
  // sit in connect-timeout before falling back. IPv6 is retained (not dropped)
  // so IPv6-only environments aren't broken.
  it("orders IPv4 before IPv6 when no family is requested", () => {
    expect(filterSafeResolvedAddresses([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ])).toEqual([
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ])
  })

  it("returns only the requested family when one is specified and available", () => {
    expect(filterSafeResolvedAddresses([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ], 6)).toEqual([{ address: "2606:4700:4700::1111", family: 6 }])
  })

  it("falls back to all addresses when the requested family has no match", () => {
    // Undici asked for IPv4 but DNS only returned IPv6 — don't lie with an empty
    // answer (that trips undici's "no addresses" path); hand over what we have.
    expect(filterSafeResolvedAddresses([
      { address: "2606:4700:4700::1111", family: 6 },
    ], 4)).toEqual([{ address: "2606:4700:4700::1111", family: 6 }])
  })

  it("rejects the whole answer set if any resolved address is private or reserved", () => {
    expect(() => filterSafeResolvedAddresses([
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ])).toThrow(/10\.0\.0\.7/)
  })
})

// ---------------------------------------------------------------------------
// Fast-fail before any network call / DNS resolution
// ---------------------------------------------------------------------------

describe("safeFetch — fast-fail", () => {
  it("rejects non-http(s) protocols synchronously", async () => {
    await expect(safeFetch("ftp://example.com/file")).rejects.toThrow(/protocol ftp/)
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/protocol file/)
  })

  it("rejects literal private IPv4 before DNS resolution", async () => {
    await expect(safeFetch("http://127.0.0.1/secret")).rejects.toThrow(/127\.0\.0\.1/)
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/169\.254\.169\.254/)
    await expect(safeFetch("http://10.0.0.1/internal")).rejects.toThrow(/10\.0\.0\.1/)
    await expect(safeFetch("http://192.168.1.1/internal")).rejects.toThrow(/192\.168\.1\.1/)
  })

  it("rejects literal IPv6 loopback, link-local, ULA", async () => {
    await expect(safeFetch("http://[::1]/api")).rejects.toThrow(/::1/)
    await expect(safeFetch("http://[fe80::1]/api")).rejects.toThrow(/fe80::1/)
    await expect(safeFetch("http://[fc00::1]/api")).rejects.toThrow(/fc00::1/)
  })

  // A malformed URL used to surface as Node's bare "Invalid URL" — which is the
  // ENTIRE explanation a failed merge carried into /admin/app-reports
  // (2026-09-04). Every other refusal here names what it refused.
  it("names the value when the URL cannot be parsed at all", async () => {
    await expect(safeFetch("the quick brown fox")).rejects.toThrow(
      /safeFetch: not a valid URL: "the quick brown fox"/,
    )
    await expect(safeFetch("")).rejects.toThrow(/not a valid URL: ""/)
  })

  it("keeps the named value short and single-line", async () => {
    const junk = `line one\nline two ${"x".repeat(400)}`
    const err = await safeFetch(junk).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/^safeFetch: not a valid URL: /)
    expect(err?.message.length).toBeLessThan(200)
    expect(err?.message).not.toContain("\n")
  })
})

// ---------------------------------------------------------------------------
// Redirect-hop SSRF gate. safeFetch follows redirects MANUALLY and re-validates
// every hop, because the agent's connect.lookup gate is SKIPPED by Node for
// IP-literal hosts — so a public URL that 302s to http://127.0.0.1/ would
// otherwise reach an internal target. assertSafeRedirectTarget is the per-hop
// enforcement point. (The full public→internal path can't be exercised in a
// hermetic unit test — there is no real public host to redirect FROM — so we
// test the gate directly; undici's redirect:"manual" exposing a readable
// Location, which the follow loop relies on, was verified against the vendored
// undici during the fix.)
// ---------------------------------------------------------------------------

describe("safeFetch — redirect-hop SSRF gate (assertSafeRedirectTarget)", () => {
  it("blocks a redirect to an IP-literal loopback / metadata / private / any-addr host", () => {
    expect(() => assertSafeRedirectTarget("http://127.0.0.1/x")).toThrow(/127\.0\.0\.1/)
    expect(() => assertSafeRedirectTarget("http://169.254.169.254/latest/meta-data/")).toThrow(/169\.254\.169\.254/)
    expect(() => assertSafeRedirectTarget("http://10.0.0.5/internal")).toThrow(/10\.0\.0\.5/)
    expect(() => assertSafeRedirectTarget("http://192.168.1.1/")).toThrow(/192\.168\.1\.1/)
    expect(() => assertSafeRedirectTarget("http://0.0.0.0/")).toThrow(/0\.0\.0\.0/)
  })

  it("blocks a redirect to an IP-literal IPv6 loopback / link-local / ULA host", () => {
    expect(() => assertSafeRedirectTarget("http://[::1]/api")).toThrow(/::1/)
    expect(() => assertSafeRedirectTarget("http://[fe80::1]/api")).toThrow(/fe80::1/)
    expect(() => assertSafeRedirectTarget("http://[fc00::1]/api")).toThrow(/fc00::1/)
  })

  it("blocks a redirect to a non-http(s) protocol", () => {
    expect(() => assertSafeRedirectTarget("file:///etc/passwd")).toThrow(/protocol file/)
    expect(() => assertSafeRedirectTarget("gopher://x/")).toThrow(/protocol gopher/)
  })

  it("blocks a redirect to an unparseable Location", () => {
    expect(() => assertSafeRedirectTarget("::::not a url")).toThrow(/invalid URL/)
  })

  it("blocks a redirect to an ENCODED/obfuscated internal IP (WHATWG normalizes, classifier flags)", () => {
    // Decimal, hex, octal, short-form, and IPv6-mapped encodings all canonicalize
    // to a private/reserved dotted-quad via `new URL()` and are then blocked.
    for (const u of [
      "http://2130706433/",        // 127.0.0.1
      "http://0x7f000001/",        // 127.0.0.1
      "http://0177.0.0.1/",        // 127.0.0.1
      "http://127.1/",             // 127.0.0.1
      "http://127.0.0.1./",        // trailing dot
      "http://2852039166/",        // 169.254.169.254 (metadata)
      "http://[::ffff:127.0.0.1]/", // IPv4-mapped IPv6
    ]) {
      expect(() => assertSafeRedirectTarget(u), u).toThrow()
    }
  })

  it("allows a redirect to a public host (hostname DNS is still gated at connect time)", () => {
    expect(() => assertSafeRedirectTarget("https://example.com/path")).not.toThrow()
    expect(() => assertSafeRedirectTarget("http://cdn.example.org/a.mp4")).not.toThrow()
  })
})
