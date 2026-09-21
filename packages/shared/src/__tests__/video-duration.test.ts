import { describe, it, expect } from "vitest"
import { editPlanSourceDurationSec, extractVideoDurationFromNode } from "../video-duration.js"

describe("editPlanSourceDurationSec", () => {
  it("reads a video node's own length first", () => {
    expect(editPlanSourceDurationSec({ duration: 90 })).toBe(90)
    expect(editPlanSourceDurationSec({ activeResultIndex: 0, generatedResults: [{ duration: 42 }] })).toBe(42)
    expect(extractVideoDurationFromNode({ duration: 90 })).toBe(90)
  })

  it("reads the audio lane's metadata.durationSeconds (upload-audio: unstamped, trusted as ever)", () => {
    expect(editPlanSourceDurationSec({ url: "https://cdn/a.mp3", metadata: { durationSeconds: 2700 } })).toBe(2700)
  })

  it("rejects nonsense lengths", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "2700", null]) {
      expect(editPlanSourceDurationSec({ metadata: { durationSeconds: bad } })).toBeUndefined()
    }
    expect(editPlanSourceDurationSec(undefined)).toBeUndefined()
    expect(editPlanSourceDurationSec({})).toBeUndefined()
  })
})

// The read-side invariant. A length stamped with the media it was measured from
// is trusted only while that media is still the node's — so NO writer can make
// it stale: not a copilot patch, an MCP workflow-JSON write, an import, a
// run-time override, nor code that has not been written yet. A mismatch reads as
// "unknown", and every caller then falls to its safe side instead of
// under-bucketing a longer file.
describe("editPlanSourceDurationSec — a stamped length is bound to its media", () => {
  const stamped = (mediaUrl: string) => ({ durationSeconds: 720, mediaUrl })

  it("trusts the length while the stamp matches the node's extracted audio", () => {
    expect(
      editPlanSourceDurationSec({ extractedAudioUrl: "https://cdn/ep41.mp3", metadata: stamped("https://cdn/ep41.mp3") }),
    ).toBe(720)
  })

  it("ignores it once the media was swapped underneath — whoever swapped it", () => {
    // e.g. copilot `patchNodes { extractedAudioUrl }` / MCP update_workflow_json:
    // a shallow merge that replaces the url and carries `metadata` along.
    expect(
      editPlanSourceDurationSec({ extractedAudioUrl: "https://host/ep42-3h.mp3", metadata: stamped("https://cdn/ep41.mp3") }),
    ).toBeUndefined()
  })

  it("ignores it when the media was cleared", () => {
    expect(editPlanSourceDurationSec({ extractedAudioUrl: "", metadata: stamped("https://cdn/ep41.mp3") })).toBeUndefined()
    expect(editPlanSourceDurationSec({ metadata: stamped("https://cdn/ep41.mp3") })).toBeUndefined()
  })

  it("accepts a stamp matching the node's `url` field too (upload-style nodes)", () => {
    expect(editPlanSourceDurationSec({ url: "https://cdn/a.mp3", metadata: stamped("https://cdn/a.mp3") })).toBe(720)
    expect(editPlanSourceDurationSec({ url: "https://cdn/b.mp3", metadata: stamped("https://cdn/a.mp3") })).toBeUndefined()
  })
})
