/**
 * The update check behind the sidebar red dot. The load-bearing behaviors:
 * npm-package releases sharing the repo must never be mistaken for an app
 * release; failures degrade to silence; one outbound request per TTL; cloud
 * and opted-out installs make no request at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const editionMock = vi.hoisted(() => ({ isCloud: vi.fn(() => false) }))
vi.mock("../config.js", () => ({ isCloud: editionMock.isCloud }))
vi.mock("../app-version.js", () => ({ getAppVersion: () => "1.23.0" }))

import {
  getUpdateStatus,
  isNewer,
  retryAfterMs,
  updateCheckEnabled,
  _resetUpdateCheckForTests,
} from "../update-check.js"

const fetchMock = vi.fn()

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/nodaroai/app.nodaro.ai/releases/tag/${tag}`,
  published_at: "2026-08-19T00:00:00Z",
  body: `Changes in ${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
})

const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

beforeEach(() => {
  _resetUpdateCheckForTests()
  editionMock.isCloud.mockReturnValue(false)
  delete process.env.NODARO_UPDATE_CHECK
  fetchMock.mockReset()
  warn.mockClear()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.NODARO_UPDATE_CHECK
  delete process.env.NODARO_UPDATE_CHECK_TOKEN
  delete process.env.RAILWAY_GIT_COMMIT_SHA
})

describe("isNewer", () => {
  it("compares semver numerically, not lexically", () => {
    expect(isNewer("1.23.0", "v2.0.0")).toBe(true)
    expect(isNewer("v2.0.0", "v1.23.0")).toBe(false)
    expect(isNewer("1.9.0", "1.10.0")).toBe(true)
    expect(isNewer("2.0.0", "2.0.0")).toBe(false)
  })

  it("a local -dev build never nags about itself", () => {
    expect(isNewer("1.23.0-dev.abc123", "v1.23.0")).toBe(false)
    expect(isNewer("0.0.0-dev", "v2.0.0")).toBe(true)
  })
})

describe("deployed-SHA version resolution (the cloud label fix)", () => {
  const tagsPayload = [
    { name: "v1.27.0", commit: { sha: "deadbeef27" } },
    { name: "@nodaro/sdk@9.9.9", commit: { sha: "deadbeef27" } }, // npm tag on the same sha must never win
    { name: "v1.26.1", commit: { sha: "cafebabe26" } },
  ]

  it("cloud: the running SHA's release tag becomes `current` — the label stops lying", async () => {
    editionMock.isCloud.mockReturnValue(true)
    process.env.RAILWAY_GIT_COMMIT_SHA = "deadbeef27"
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/tags")
        ? { ok: true, json: async () => tagsPayload }
        : { ok: true, json: async () => [release("v1.27.0")] },
    )
    const status = await getUpdateStatus()
    expect(status.current).toBe("1.27.0")
    expect(status.updateAvailable).toBe(false)
  })

  it("an untagged SHA (staging runs dev commits) keeps the fallback and never throws", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "not-a-release-sha"
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/tags")
        ? { ok: true, json: async () => tagsPayload }
        : { ok: true, json: async () => [release("v1.27.0")] },
    )
    const status = await getUpdateStatus()
    expect(status.current).toBe("1.23.0")
  })

  it("no RAILWAY_GIT_COMMIT_SHA (self-host) -> no tags request at all", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v1.24.0")] })
    await getUpdateStatus()
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/tags"))).toBe(true)
  })
})

describe("getUpdateStatus", () => {
  it("picks the newest APP release and ignores the npm package releases sharing the repo", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        release("@nodaro/prompts@1.7.2"), // "latest" on GitHub the day this was written
        release("@nodaro/sdk@9.9.9"),
        release("v2.0.0"),
        release("v1.24.0"),
      ],
    })
    const status = await getUpdateStatus()
    expect(status.updateAvailable).toBe(true)
    expect(status.latest?.version).toBe("v2.0.0")
  })

  it("skips drafts and prereleases", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        release("v3.0.0", { draft: true }),
        release("v2.1.0", { prerelease: true }),
        release("v1.24.0"),
      ],
    })
    const status = await getUpdateStatus()
    expect(status.latest?.version).toBe("v1.24.0")
  })

  it("caches — a second call makes no second request", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v2.0.0")] })
    await getUpdateStatus()
    await getUpdateStatus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a GitHub failure degrades to 'no update known' — never an error, never a nag", async () => {
    fetchMock.mockRejectedValue(new Error("api down"))
    const status = await getUpdateStatus()
    expect(status).toEqual({ current: "1.23.0", latest: null, updateAvailable: false })
  })

  it("NODARO_UPDATE_CHECK=off makes no request at all", async () => {
    process.env.NODARO_UPDATE_CHECK = "off"
    const status = await getUpdateStatus()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(status.updateAvailable).toBe(false)
    expect(updateCheckEnabled()).toBe(false)
  })

  it("cloud: latest still flows (the what's-new dialog reads it) but updateAvailable is ALWAYS false", async () => {
    editionMock.isCloud.mockReturnValue(true)
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v9.0.0")] })
    const status = await getUpdateStatus()
    expect(status.latest?.version).toBe("v9.0.0")
    expect(status.updateAvailable).toBe(false)
  })

  it("running the latest already -> updateAvailable false, latest still reported", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v1.23.0")] })
    const status = await getUpdateStatus()
    expect(status.updateAvailable).toBe(false)
    expect(status.latest?.version).toBe("v1.23.0")
  })
})

/**
 * A failed read is not an answer.
 *
 * Production, 2026-09-20, on a fresh deploy: `{"current":"1.23.0","latest":null}`
 * — while staging, same code, answered correctly, and NODARO_UPDATE_CHECK was
 * not set on either. GitHub gives an anonymous caller 60 requests an hour PER
 * ADDRESS and a hosted deployment shares its address, so one refused request is
 * ordinary; the bug was that it was cached like an answer, for 24 hours, by a
 * process that had only just booted.
 */
describe("a read that fails is tried again soon — it is not cached like an answer", () => {
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const ok = (body: unknown) => ({ ok: true, json: async () => body })
  const refused = {
    ok: false,
    status: 403,
    headers: new Headers({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1789898400" }),
  }

  beforeEach(() => {
    // Only the clock: the fetch mock and its promises run on real microtasks.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-20T00:40:00Z"))
  })

  it("the schedule: 5 min, 15 min, 45 min … never past the full 24 h", () => {
    expect([1, 2, 3, 4].map(retryAfterMs)).toEqual([5 * MINUTE, 15 * MINUTE, 45 * MINUTE, 135 * MINUTE])
    expect(retryAfterMs(7)).toBe(24 * HOUR)
    expect(retryAfterMs(50)).toBe(24 * HOUR)
  })

  it("a refused release read heals five minutes later, not a day later", async () => {
    fetchMock.mockResolvedValueOnce(refused)
    expect((await getUpdateStatus()).latest).toBeNull()

    // inside the wait: no second request, still unknown
    vi.advanceTimersByTime(4 * MINUTE)
    expect((await getUpdateStatus()).latest).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1 * MINUTE)
    fetchMock.mockResolvedValueOnce(ok([release("v1.144.0")]))
    expect((await getUpdateStatus()).latest?.version).toBe("v1.144.0")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("spaces repeated failures out, so a refusal that persists is not hammered", async () => {
    fetchMock.mockResolvedValue(refused)
    await getUpdateStatus() // t = 0
    const callsAfter = async (ms: number) => {
      vi.advanceTimersByTime(ms)
      await getUpdateStatus()
      return fetchMock.mock.calls.length
    }
    expect(await callsAfter(5 * MINUTE)).toBe(2) // +5 min
    expect(await callsAfter(14 * MINUTE)).toBe(2) // the next wait is 15
    expect(await callsAfter(1 * MINUTE)).toBe(3)
    expect(await callsAfter(44 * MINUTE)).toBe(3) // then 45
    expect(await callsAfter(1 * MINUTE)).toBe(4)
  })

  it("keeps the last good answer while a refresh is failing", async () => {
    fetchMock.mockResolvedValueOnce(ok([release("v1.144.0")]))
    expect((await getUpdateStatus()).latest?.version).toBe("v1.144.0")

    vi.advanceTimersByTime(24 * HOUR)
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"))
    expect((await getUpdateStatus()).latest?.version).toBe("v1.144.0")

    vi.advanceTimersByTime(5 * MINUTE)
    fetchMock.mockResolvedValueOnce(ok([release("v1.145.0"), release("v1.144.0")]))
    expect((await getUpdateStatus()).latest?.version).toBe("v1.145.0")
  })

  it("a page with no app release on it IS an answer — kept for the full day", async () => {
    fetchMock.mockResolvedValue(ok([release("@nodaro/sdk@2.12.0")]))
    expect((await getUpdateStatus()).latest).toBeNull()
    vi.advanceTimersByTime(23 * HOUR)
    await getUpdateStatus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("says why in the log — the status and the quota — once per failed read", async () => {
    fetchMock.mockResolvedValue(refused)
    await getUpdateStatus()
    await getUpdateStatus()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/\[update-check\] latest release read failed: HTTP 403 \(rate limit: 0 of 60 left, resets 2026-/)
    expect(String(warn.mock.calls[0][0])).toContain("next try in 5 min")
  })

  it("a timeout and a thrown error are failures too, never a thrown status", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
    await expect(getUpdateStatus()).resolves.toEqual({ current: "1.23.0", latest: null, updateAvailable: false })
    expect(String(warn.mock.calls[0][0])).toContain("timed out")
  })
})

describe("the deployed commit's version", () => {
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const tagged = [{ name: "v1.144.0", commit: { sha: "e6017ded" } }]
  const notYet = [{ name: "v1.143.0", commit: { sha: "8dd631ff" } }]
  const answers = (tags: unknown) => async (url: unknown) =>
    String(url).includes("/tags") ? { ok: true, json: async () => tags } : { ok: true, json: async () => [release("v1.144.0")] }
  const tagReads = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/tags")).length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-20T00:40:00Z"))
    editionMock.isCloud.mockReturnValue(true)
    process.env.RAILWAY_GIT_COMMIT_SHA = "e6017ded"
  })

  it("a process that boots BEFORE its own release tag exists finds it minutes later", async () => {
    // The tag is pushed by a workflow that runs after the merge that triggered
    // the deploy, so "no tag for this commit" at boot means "not yet".
    fetchMock.mockImplementation(answers(notYet))
    expect((await getUpdateStatus()).current).toBe("1.23.0")

    vi.advanceTimersByTime(5 * MINUTE)
    fetchMock.mockImplementation(answers(tagged))
    expect((await getUpdateStatus()).current).toBe("1.144.0")
  })

  it("is not logged while it is only 'not yet' — staging lives there", async () => {
    fetchMock.mockImplementation(answers(notYet))
    await getUpdateStatus()
    expect(warn).not.toHaveBeenCalled()
  })

  it("once found it is never asked again — a running process does not change commit", async () => {
    fetchMock.mockImplementation(answers(tagged))
    expect((await getUpdateStatus()).current).toBe("1.144.0")
    vi.advanceTimersByTime(72 * HOUR)
    expect((await getUpdateStatus()).current).toBe("1.144.0")
    expect(tagReads()).toBe(1)
  })

  it("a refused tags read is retried on the same schedule, and logged", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/tags") ? { ok: false, status: 403 } : { ok: true, json: async () => [release("v1.144.0")] },
    )
    expect((await getUpdateStatus()).current).toBe("1.23.0")
    expect(String(warn.mock.calls[0][0])).toContain("deployed version read failed: HTTP 403")

    vi.advanceTimersByTime(5 * MINUTE)
    fetchMock.mockImplementation(answers(tagged))
    expect((await getUpdateStatus()).current).toBe("1.144.0")
  })
})

describe("NODARO_UPDATE_CHECK_TOKEN", () => {
  const headersOf = (call: unknown[]) => ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>

  it("reads anonymously by default", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v1.24.0")] })
    await getUpdateStatus()
    expect(headersOf(fetchMock.mock.calls[0]).Authorization).toBeUndefined()
  })

  it("rides on every GitHub read when set — and never reaches the log", async () => {
    process.env.NODARO_UPDATE_CHECK_TOKEN = "  not-a-real-token  "
    process.env.RAILWAY_GIT_COMMIT_SHA = "abc"
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await getUpdateStatus()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect(headersOf(call).Authorization).toBe("Bearer not-a-real-token")
      expect(String(call[0])).toMatch(/^https:\/\/api\.github\.com\//)
    }
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.flat().join(" ")).not.toContain("not-a-real-token")
  })
})
