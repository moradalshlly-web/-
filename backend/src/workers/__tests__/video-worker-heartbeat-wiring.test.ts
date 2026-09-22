// The video worker stamps `provider_kind = "pre-task"` on every row at pickup,
// and the reconcile cron fails + refunds a row whose stamp is 30 minutes old.
// A handler that runs longer must keep beating the sentinel. The wrapper used
// to cover ONLY the private-plugin map — so a core ffmpeg long-runner
// (apply-edl on an hour-long multicam cut) aged into the sweep with its worker
// still rendering. The worker now wraps the WHOLE final handler map, so every
// job type present and future is covered without naming any. This pins the
// wiring: a refactor that wraps a sub-map again fails here.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker pre-task heartbeat wiring", () => {
  it("wraps the whole handler map, after every merge into it", () => {
    const wrapAt = code.indexOf("withPreTaskHeartbeats(allHandlers)")
    expect(wrapAt, "the final allHandlers map must be wrapped").toBeGreaterThan(-1)
    // No merge into allHandlers may come AFTER the wrap — it would land unwrapped.
    const after = code.slice(wrapAt + "withPreTaskHeartbeats(allHandlers)".length)
    expect(after).not.toMatch(/Object\.assign\(allHandlers,/)
  })

  it("does not wrap only a sub-map (the plugin-only coverage that missed core long-runners)", () => {
    expect(code).not.toMatch(/withPreTaskHeartbeats\((?!allHandlers\))/)
  })
})
