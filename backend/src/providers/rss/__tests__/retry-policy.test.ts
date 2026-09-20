import { describe, it, expect } from "vitest"
import {
  MAX_ATTEMPTS,
  MAX_RETRY_WAIT_MS,
  backoffDelayMs,
  parseRetryAfterMs,
  retriesAllowedFor,
} from "../retry-policy.js"

describe("retriesAllowedFor", () => {
  it("gives a network failure and the transient statuses the full schedule", () => {
    expect(retriesAllowedFor({ kind: "network" })).toBe(MAX_ATTEMPTS - 1)
    for (const status of [408, 425, 429, 500, 502, 503, 504, 599]) {
      expect(retriesAllowedFor({ kind: "http", status })).toBe(MAX_ATTEMPTS - 1)
    }
  })

  it("gives a 404 exactly one retry", () => {
    expect(retriesAllowedFor({ kind: "http", status: 404 })).toBe(1)
  })

  it("gives every other status none", () => {
    for (const status of [301, 400, 401, 402, 403, 405, 406, 410, 418, 451]) {
      expect(retriesAllowedFor({ kind: "http", status })).toBe(0)
    }
  })

  it("keeps the schedule small", () => {
    expect(MAX_ATTEMPTS).toBe(3)
  })
})

describe("backoffDelayMs", () => {
  it("doubles per retry and never drops under half the step", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(400)
    expect(backoffDelayMs(2, () => 0)).toBe(800)
  })

  it("spreads retries across the upper half of the step (equal jitter)", () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(600)
    expect(backoffDelayMs(1, () => 0.999999)).toBe(800)
    expect(backoffDelayMs(2, () => 0.999999)).toBe(1600)
  })

  it("returns whole milliseconds", () => {
    expect(Number.isInteger(backoffDelayMs(1, () => 0.123456))).toBe(true)
  })

  it("the whole schedule is a few seconds at most — far inside the ~100 s edge limit", () => {
    const worst = backoffDelayMs(1, () => 1) + backoffDelayMs(2, () => 1)
    expect(worst).toBeLessThanOrEqual(2_400)
    expect(MAX_RETRY_WAIT_MS).toBeLessThanOrEqual(5_000)
  })
})

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-09-20T10:00:00.000Z")

  it("reads delta-seconds", () => {
    expect(parseRetryAfterMs("2", now)).toBe(2_000)
    expect(parseRetryAfterMs(" 120 ", now)).toBe(120_000)
    expect(parseRetryAfterMs("0", now)).toBe(0)
  })

  it("reads an HTTP date, never as a negative wait", () => {
    expect(parseRetryAfterMs("Sun, 20 Sep 2026 10:00:03 GMT", now)).toBe(3_000)
    expect(parseRetryAfterMs("Sun, 20 Sep 2026 09:00:00 GMT", now)).toBe(0)
  })

  it("answers undefined for a missing or unreadable header", () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined()
    expect(parseRetryAfterMs("", now)).toBeUndefined()
    expect(parseRetryAfterMs("soon", now)).toBeUndefined()
    expect(parseRetryAfterMs("-5", now)).toBeUndefined()
    expect(parseRetryAfterMs("1.5", now)).toBeUndefined()
  })
})
