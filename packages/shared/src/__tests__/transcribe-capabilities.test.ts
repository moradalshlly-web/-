import { describe, it, expect } from "vitest"
import {
  TRANSCRIBE_PROVIDERS,
  TRANSCRIBE_LANES,
  TRANSCRIBE_PROVIDER_CAPABILITIES,
  transcribeProvidersWithWordTimestamps,
  transcribeLaneSupportsWordTimestamps,
  DEFAULT_TRANSCRIBE_PROVIDER,
  DEFAULT_TRANSCRIBE_NODE_PROVIDER,
} from "../model-constants.js"

describe("transcribe lane capabilities", () => {
  it("every lane has a capability entry", () => {
    const missing = TRANSCRIBE_LANES.filter((p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p] === undefined)
    expect(missing, `lanes without a capability row: ${missing.join(", ")}`).toEqual([])
  })

  it("every TRANSCRIBE_PROVIDERS member is a lane with a capability entry", () => {
    // The user-facing enum is a SUBSET of the lanes. A provider a caller can
    // name but whose capabilities are unknown is the bug this pins.
    const lanes = new Set<string>(TRANSCRIBE_LANES)
    const orphans = TRANSCRIBE_PROVIDERS.filter((p) => !lanes.has(p))
    expect(orphans, `TRANSCRIBE_PROVIDERS members missing from TRANSCRIBE_LANES: ${orphans.join(", ")}`).toEqual([])
    for (const p of TRANSCRIBE_PROVIDERS) {
      expect(TRANSCRIBE_PROVIDER_CAPABILITIES[p]).toBeDefined()
    }
  })

  it("the capability map has no entry that is not a lane", () => {
    const lanes = new Set<string>(TRANSCRIBE_LANES)
    const extra = Object.keys(TRANSCRIBE_PROVIDER_CAPABILITIES).filter((k) => !lanes.has(k))
    expect(extra, `capability rows for unknown lanes: ${extra.join(", ")}`).toEqual([])
  })

  it("openai/whisper cannot do word timestamps; the other two can", () => {
    // Not a taste call: openai/whisper on Replicate has no `word_timestamps`
    // input in any published version, so the key is silently dropped.
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES.whisper.wordTimestamps).toBe(false)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES["incredibly-fast-whisper"].wordTimestamps).toBe(true)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES["elevenlabs-stt"].wordTimestamps).toBe(true)
  })

  it("transcribeProvidersWithWordTimestamps derives from the capability map", () => {
    expect(transcribeProvidersWithWordTimestamps()).toEqual(["incredibly-fast-whisper", "elevenlabs-stt"])
  })

  it("the default lane is itself a lane", () => {
    expect(TRANSCRIBE_LANES).toContain(DEFAULT_TRANSCRIBE_PROVIDER)
  })

  it("the transcribe NODE default is a lane, is ENABLED, and is word-capable", () => {
    // The canvas node and the DAG both resolve an absent provider to this one,
    // so it has to be a lane the route still accepts AND one that can answer the
    // word-timings request a wired `json` handle infers.
    expect(TRANSCRIBE_LANES).toContain(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
    expect(TRANSCRIBE_PROVIDERS as readonly string[]).toContain(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES[DEFAULT_TRANSCRIBE_NODE_PROVIDER].wordTimestamps).toBe(true)
  })
})

describe("transcribeLaneSupportsWordTimestamps — untrusted lane ids", () => {
  it("answers the capability table for every known lane", () => {
    for (const lane of TRANSCRIBE_LANES) {
      expect(transcribeLaneSupportsWordTimestamps(lane)).toBe(
        TRANSCRIBE_PROVIDER_CAPABILITIES[lane].wordTimestamps,
      )
    }
  })

  it("answers false for a lane it has never heard of", () => {
    // Node data is untrusted: an imported workflow can carry any string. The
    // caller must not index the capability table directly (TypeError) nor
    // assume a capability it cannot verify.
    expect(transcribeLaneSupportsWordTimestamps("deepgram")).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps("")).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps(undefined)).toBe(false)
    expect(transcribeLaneSupportsWordTimestamps(null)).toBe(false)
  })
})
