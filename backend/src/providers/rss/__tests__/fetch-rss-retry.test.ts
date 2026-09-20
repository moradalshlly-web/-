/**
 * Transient upstream failures.
 *
 * On 2026-09-20 youtube.com/feeds/videos.xml answered 404 and 500 for EVERY
 * channel (YouTube's own included) from three independent networks for 10+
 * minutes, minutes after answering 200. `fetchRssItems` made one request and
 * gave up. It now makes a small, bounded number of attempts — all inside the
 * one timeout it always had.
 *
 * Hermetic: the fetch is injected and the clock is fake (`Date.now()` too), so
 * a backoff costs no wall-clock time and every delay can be read off exactly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchRssItems } from "../parser.js"
import { BLOG_ATOM } from "./fixtures/atom-feeds.js"

const URL = "https://example.com/feed.xml"

// A Response body is single-use, so every step is a FACTORY: one scripted step
// can then answer more than one request.
type Step = Error | (() => Response)

function ok(body = BLOG_ATOM): Step {
  return () => new Response(new TextEncoder().encode(body), { status: 200 })
}

function status(code: number, headers: Record<string, string> = {}): Step {
  return () => new Response("upstream says no", { status: code, headers })
}

function networkError(code = "ECONNRESET"): Error {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) })
}

/** A fetch that plays `steps` in order and records WHEN each request went out. */
function scripted(steps: Step[]) {
  const at: number[] = []
  const impl = vi.fn(async () => {
    at.push(Date.now())
    const step = steps[Math.min(at.length - 1, steps.length - 1)]
    if (step instanceof Error) throw step
    return step()
  })
  return { impl: impl as unknown as typeof fetch, calls: impl, at }
}

/** Run every pending timer (the backoffs) and hand back how the call ended. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: Error }> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  )
  await vi.runAllTimersAsync()
  return outcome
}

describe("fetchRssItems — transient upstream failures", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"))
    // Jitter pinned to its floor, so the schedule is exact: 400 ms, then 800 ms.
    vi.spyOn(Math, "random").mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("retries a 5xx and returns the feed once the upstream answers", async () => {
    const feed = scripted([status(503), ok()])
    const { value, error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error).toBeUndefined()
    expect(value).toHaveLength(2)
    expect(feed.calls).toHaveBeenCalledTimes(2)
  })

  it("retries a network error", async () => {
    const feed = scripted([networkError("ECONNRESET"), networkError("EAI_AGAIN"), ok()])
    const { value } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(value).toHaveLength(2)
    expect(feed.calls).toHaveBeenCalledTimes(3)
  })

  it("retries a connection that drops while the body is being read", async () => {
    const dropped = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<?xml"))
            controller.error(Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } }))
          },
        }),
        { status: 200 },
      )
    const feed = scripted([dropped, ok()])
    const { value } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(value).toHaveLength(2)
    expect(feed.calls).toHaveBeenCalledTimes(2)
  })

  it.each([408, 425, 429, 500, 502, 503, 504])("treats HTTP %i as transient", async (code) => {
    const feed = scripted([status(code), ok()])
    const { value } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(value).toHaveLength(2)
  })

  it("gives up after three attempts, with the last status in the message", async () => {
    const feed = scripted([status(500), status(502), status(503)])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/HTTP 503/)
    expect(feed.calls).toHaveBeenCalledTimes(3)
  })

  it("backs off exponentially: 400 ms, then 800 ms, at the jitter floor", async () => {
    const feed = scripted([status(500), status(500), status(500)])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    const t0 = feed.at[0]
    expect(feed.at.map((t) => t - t0)).toEqual([0, 400, 1200])
  })

  it("adds jitter on top of the floor, never more than doubling it", async () => {
    vi.mocked(Math.random).mockReturnValue(0.999999)
    const feed = scripted([status(500), status(500), status(500)])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    const [first, second] = [feed.at[1] - feed.at[0], feed.at[2] - feed.at[1]]
    expect(first).toBeGreaterThan(400)
    expect(first).toBeLessThanOrEqual(800)
    expect(second).toBeGreaterThan(800)
    expect(second).toBeLessThanOrEqual(1600)
  })

  it("releases the failed response before trying again", async () => {
    let cancelled = false
    const failing = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true
          },
        }),
        { status: 503 },
      )
    const feed = scripted([failing, ok()])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(cancelled).toBe(true)
  })

  it("reports each retry to the caller", async () => {
    const onRetry = vi.fn()
    const feed = scripted([status(503), networkError(), ok()])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl, onRetry }))
    expect(onRetry.mock.calls.map(([info]) => info)).toEqual([
      { attempt: 1, delayMs: 400, reason: "HTTP 503" },
      { attempt: 2, delayMs: 800, reason: "fetch failed" },
    ])
  })
})

describe("fetchRssItems — a 404 earns exactly one retry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("recovers when the 404 was a blip (the 2026-09-20 shape)", async () => {
    const feed = scripted([status(404), ok()])
    const { value } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(value).toHaveLength(2)
    expect(feed.calls).toHaveBeenCalledTimes(2)
  })

  it("a real 404 fails after ONE retry, not the full schedule", async () => {
    const feed = scripted([status(404)])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/HTTP 404/)
    expect(feed.calls).toHaveBeenCalledTimes(2)
  })

  it("a 404 that follows another failure is final — three attempts is still the ceiling", async () => {
    const feed = scripted([status(503), status(404), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/HTTP 404/)
    expect(feed.calls).toHaveBeenCalledTimes(2)
  })
})

describe("fetchRssItems — what is never retried", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([400, 401, 403, 410, 451])("HTTP %i is a verdict", async (code) => {
    const feed = scripted([status(code), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(new RegExp(`HTTP ${code}`))
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("an address the SSRF guard refused", async () => {
    const feed = scripted([new Error("safeFetch: blocked — 10.0.0.7 is a private/reserved IP"), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/private\/reserved IP/)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("a feed that is too large", async () => {
    const big = () => new Response("x", { status: 200, headers: { "content-length": "99999999" } })
    const feed = scripted([big, ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl, maxBytes: 1_000 }))
    expect(error?.message).toMatch(/too large/i)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("a document whose root element is NAMED like a network error", async () => {
    // The not-a-feed message quotes the root element — text the upstream chose.
    // If that verdict could reach the transport classifier, a body of
    // <ECONNRESET/> would read as a dropped connection and buy itself retries.
    for (const name of ["ECONNRESET", "ENOTFOUND", "ECONNREFUSED"]) {
      const feed = scripted([() => new Response(`<${name}></${name}>`, { status: 200 }), ok()])
      const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
      expect(error?.message).toMatch(/not an RSS or Atom feed/i)
      expect(feed.calls).toHaveBeenCalledTimes(1)
    }
  })

  it("a response that is not a feed", async () => {
    const feed = scripted([() => new Response("<html><body>hello</body></html>", { status: 200 }), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/not an RSS or Atom feed/i)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })
})

describe("fetchRssItems — the whole run stays inside the one timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("does not start a wait that would outlive the budget", async () => {
    const feed = scripted([status(503), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl, timeoutMs: 300 }))
    expect(error?.message).toMatch(/HTTP 503/)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("a retry that hangs is cut off by the same timer — and is not retried again", async () => {
    let hung: ReadableStreamDefaultController<Uint8Array> | undefined
    const at: number[] = []
    const impl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      at.push(Date.now())
      if (at.length === 1) return new Response("upstream says no", { status: 503 })
      init?.signal?.addEventListener("abort", () => hung?.error(new Error("aborted")))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            hung = controller
            controller.enqueue(new TextEncoder().encode("<?xml"))
          },
        }),
        { status: 200 },
      )
    })
    const started = Date.now()
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: impl as unknown as typeof fetch, timeoutMs: 5_000 }))
    // The run says it ran out of time — and what the upstream last answered,
    // which is the useful half when it died during a retry.
    expect(error?.message).toBe("RSS fetch timed out after 5000 ms (last answer: HTTP 503)")
    expect(impl).toHaveBeenCalledTimes(2)
    expect(Date.now() - started).toBe(5_000)
  })

  it("a first attempt that hangs says it timed out, with nothing to add", async () => {
    const impl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      let hung: ReadableStreamDefaultController<Uint8Array> | undefined
      init?.signal?.addEventListener("abort", () => hung?.error(new Error("aborted")))
      return new Response(new ReadableStream<Uint8Array>({ start: (c) => { hung = c } }), { status: 200 })
    })
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: impl as unknown as typeof fetch, timeoutMs: 1_000 }))
    expect(error?.message).toBe("RSS fetch timed out after 1000 ms")
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it("waits as long as a 429 asks (Retry-After in seconds) when that fits", async () => {
    const feed = scripted([status(429, { "retry-after": "2" }), ok()])
    const { value } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(value).toHaveLength(2)
    expect(feed.at[1] - feed.at[0]).toBe(2_000)
  })

  it("reads Retry-After as an HTTP date too", async () => {
    const feed = scripted([status(503, { "retry-after": "Sun, 20 Sep 2026 10:00:03 GMT" }), ok()])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(feed.at[1] - feed.at[0]).toBe(3_000)
  })

  it("fails at once when the upstream asks for a longer wait than a request should hold", async () => {
    const feed = scripted([status(429, { "retry-after": "120" }), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(error?.message).toMatch(/HTTP 429/)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("holds to that ceiling however large the caller's budget is", async () => {
    const feed = scripted([status(429, { "retry-after": "120" }), ok()])
    const { error } = await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl, timeoutMs: 600_000 }))
    expect(error?.message).toMatch(/HTTP 429/)
    expect(feed.calls).toHaveBeenCalledTimes(1)
  })

  it("ignores a Retry-After it cannot read", async () => {
    const feed = scripted([status(503, { "retry-after": "soon" }), ok()])
    await settle(fetchRssItems({ url: URL, fetchImpl: feed.impl }))
    expect(feed.at[1] - feed.at[0]).toBe(400)
  })
})
