// The video worker stamps `provider_kind = "pre-task"` on every row at pickup,
// and the reconcile cron fails + refunds a row whose stamp is 30 minutes old.
// A handler that runs longer must keep beating the sentinel. The wrap used to
// cover ONLY the private-plugin map — so a core ffmpeg long-runner (apply-edl
// on an hour-long multicam cut) aged into the sweep with its worker still
// rendering. The worker now wraps the handler AT THE DISPATCH SITE: the one
// place a handler is looked up and run. That is what makes the coverage total
// by construction — no merge order, no later `Object.assign`, no second map
// can leave a job type out — and it is the only thing this test has to pin:
// the looked-up handler is wrapped before it is invoked, and nothing invokes
// the bare lookup.
//
// What this does NOT prove (a textual guard cannot): that the wrapper itself
// beats — `pre-task-heartbeat.test.ts` proves that — nor that the processor
// reaches the dispatch site for every job; `video-worker.test.ts`'s liveness
// cases run real jobs through the processor and count the beats.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker pre-task heartbeat wiring", () => {
  it("wraps the looked-up handler at the dispatch site, before it is invoked", () => {
    // The lookup binds `found`; the invoked `handler` is the wrapped one.
    expect(code).toMatch(/const found = allHandlers\[job\.name\]/)
    expect(code).toMatch(/const handler = withPreTaskHeartbeat\(found\)/)
    const lookupAt = code.indexOf("const found = allHandlers[job.name]")
    const wrapAt = code.indexOf("const handler = withPreTaskHeartbeat(found)")
    expect(wrapAt).toBeGreaterThan(lookupAt)
  })

  it("never invokes the bare lookup — every call goes through the wrapped handler", () => {
    // `found(` would be a direct invocation of the unwrapped handler.
    expect(code).not.toMatch(/\bfound\s*\(/)
    // Exactly one lookup of the map by job name: a second dispatch path would
    // need its own wrap and its own guard.
    expect(code.match(/allHandlers\[job\.name\]/g)?.length).toBe(1)
  })

  it("does not ALSO wrap a map (double-wrapping a handler would beat twice per interval)", () => {
    expect(code).not.toMatch(/withPreTaskHeartbeats\(/)
  })
})
