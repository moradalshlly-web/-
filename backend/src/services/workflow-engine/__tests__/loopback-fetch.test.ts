import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  loopbackFetch,
  describeFetchError,
  isNeverDeliveredTransportError,
} from "../loopback-fetch.js"
import { DrainAbortError, beginWorkerDrain, _resetWorkerDrainForTests } from "../../../lib/worker-drain.js"

/** What Node actually throws: an opaque outer TypeError over the real cause. */
function fetchFailed(code: string, message: string): Error {
  const cause = Object.assign(new Error(message), { code })
  return Object.assign(new TypeError("fetch failed"), { cause })
}

const ok = () => new Response("{}", { status: 200 })

afterEach(() => {
  _resetWorkerDrainForTests()
  vi.restoreAllMocks()
})

describe("describeFetchError", () => {
  it("names the cause instead of collapsing to 'fetch failed'", () => {
    expect(describeFetchError(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:9000"))).toBe(
      "fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:9000)",
    )
  })

  it("survives an error with no cause", () => {
    expect(describeFetchError(new Error("boom"))).toBe("boom")
  })

  it("does not spin on a self-referential cause", () => {
    const err = new Error("loop") as Error & { cause?: unknown }
    err.cause = err
    expect(describeFetchError(err)).toBe("loop")
  })
})

describe("isNeverDeliveredTransportError", () => {
  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])(
    "%s proves the API never saw the request",
    (code) => {
      expect(isNeverDeliveredTransportError(fetchFailed(code, "x"))).toBe(true)
    },
  )

  // The billing-safety line: a socket that died mid-flight may have been
  // received and charged for, so it must never look retryable.
  it.each(["UND_ERR_SOCKET", "ECONNRESET", "UND_ERR_HEADERS_TIMEOUT", "EPIPE"])(
    "%s is ambiguous and is NOT retryable",
    (code) => {
      expect(isNeverDeliveredTransportError(fetchFailed(code, "other side closed"))).toBe(false)
    },
  )
})

describe("loopbackFetch", () => {
  it("retries a never-delivered failure and returns the eventual response", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:9000"))
      .mockResolvedValueOnce(ok())
    const res = await loopbackFetch("http://localhost:9000/v1/llm-chat/generate", { method: "POST" }, {
      label: "Sync HTTP call to /v1/llm-chat/generate",
      sleep: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry a mid-flight socket error — a non-idempotent POST may already have been charged", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(fetchFailed("UND_ERR_SOCKET", "other side closed"))
    await expect(
      loopbackFetch("http://localhost:9000/v1/llm-chat/generate", { method: "POST" }, {
        label: "Sync HTTP call to /v1/llm-chat/generate",
        sleep: async () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "Sync HTTP call to /v1/llm-chat/generate: fetch failed (UND_ERR_SOCKET: other side closed)",
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("gives up after the schedule and still names the cause", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:9000"))
    await expect(
      loopbackFetch("http://localhost:9000/v1/x", { method: "POST" }, {
        label: "Sync HTTP call to /v1/x",
        delaysMs: [1, 1],
        sleep: async () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Sync HTTP call to /v1/x: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:9000)")
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("a draining container hands the job back instead of retrying", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:9000"))
    beginWorkerDrain()
    await expect(
      loopbackFetch("http://localhost:9000/v1/x", { method: "POST" }, {
        label: "Sync HTTP call to /v1/x",
        sleep: async () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DrainAbortError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("passes a non-transport throw through, described", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Invalid header value"))
    await expect(
      loopbackFetch("http://localhost:9000/v1/x", { method: "POST" }, {
        label: "Sync HTTP call to /v1/x",
        sleep: async () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Sync HTTP call to /v1/x: Invalid header value")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

/**
 * The invariant, not the instance: a new call added with a bare `fetch()` would
 * silently go back to reporting "fetch failed" and to failing a run on a
 * connection that was never made. This fails the build instead.
 *
 * Deliberately every bare `fetch(` in the engine, not just the ones whose URL
 * literal starts with `http://localhost` — the call site that produced the
 * incident read `fetch(url, …)`, so a pattern keyed to the literal would have
 * missed exactly the line it was written for. `safeFetch(` / `loopbackFetch(`
 * carry a capital F and do not match; a genuine EXTERNAL fetch added here would
 * be flagged and belongs on an allowlist with a reason, not in a looser regex.
 */
describe("every orchestrator loopback call goes through the helper", () => {
  it("no bare fetch( survives in the workflow engine", () => {
    const dir = join(import.meta.dirname, "..")
    const offenders: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue
      if (entry.name === "loopback-fetch.ts") continue
      const source = readFileSync(join(dir, entry.name), "utf8")
      for (const [index, line] of source.split("\n").entries()) {
        if (/\bfetch\s*\(/.test(line)) offenders.push(`${entry.name}:${index + 1}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
