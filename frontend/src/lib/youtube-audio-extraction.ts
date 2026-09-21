/**
 * YouTube-audio extraction as one shared flow: submit the job, poll to a
 * terminal state, return the audio URL and its measured length.
 *
 * Two callers, on purpose: the reference-audio CONFIG PANEL (the manual
 * Extract button) and the reference-audio NODE itself (auto-extraction for a
 * node whose `youtubeUrl` arrived without the panel ever mounting — written by
 * the copilot, an import, or a template). A panel-only flow is the classic
 * fail-safe trap: effects in a panel run only while that panel is open.
 */
import { extractYouTubeAudioApi, getJobStatusLean } from "@/lib/api"

const POLL_INTERVAL_MS = 2000

export interface ExtractedAudio {
  readonly audioUrl: string
  /** Seconds, measured by the worker from the extracted file. Absent when the
   *  probe failed or the job predates it — never a guess. */
  readonly durationSeconds?: number
}

const positiveSeconds = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined

/** Resolves with the extracted audio (+ its length); rejects on a failed job. */
export async function runYouTubeAudioExtraction(youtubeUrl: string): Promise<ExtractedAudio> {
  const { jobId } = await extractYouTubeAudioApi(youtubeUrl)
  for (;;) {
    const status = await getJobStatusLean(jobId)
    if (status.status === "completed" && status.output_data?.audioUrl) {
      // `Job["output_data"]` is narrowly typed with no index signature; read the
      // length through a local cast rather than widening that shared type.
      const durationSeconds = positiveSeconds(
        (status.output_data as { durationSeconds?: unknown }).durationSeconds,
      )
      return durationSeconds !== undefined
        ? { audioUrl: status.output_data.audioUrl, durationSeconds }
        : { audioUrl: status.output_data.audioUrl }
    }
    if (status.status === "failed") {
      throw new Error(status.error_message ?? "Extraction failed")
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

/**
 * The node-data patch for a reference-audio node whose MEDIA just changed —
 * the one way any writer sets `extractedAudioUrl`.
 *
 * It ALWAYS writes `metadata`: the measured length when there is one,
 * `undefined` when there is not. That is the point. The length lives on the
 * node so every duration-bucketed consumer can price this source honestly (Edit
 * Plan quotes its 180-minute CEILING for a master with no readable length), and
 * a length is only honest while it describes the media beside it. Two bindings,
 * on purpose: every in-editor writer goes through this one patch (so new media
 * always gets its own length or an explicit "unknown"), AND the length carries a
 * `mediaUrl` stamp the shared reader checks (so a writer that never heard of
 * this builder still cannot leave last week's length under-quoting a longer
 * episode — a mismatch simply reads as unknown).
 *
 * `metadata.durationSeconds` is the same field `upload-audio` writes and the
 * shared `editPlanSourceDurationSec` reads — frontend estimate and server
 * reserve fallback alike.
 */
export function referenceAudioMediaPatch(
  audioUrl: string,
  durationSeconds?: number,
): {
  extractedAudioUrl: string
  extractionStatus: "ready" | "idle"
  metadata: { durationSeconds: number; mediaUrl: string } | undefined
} {
  const seconds = positiveSeconds(durationSeconds)
  return {
    extractedAudioUrl: audioUrl,
    extractionStatus: audioUrl ? "ready" : "idle",
    // `mediaUrl` stamps WHICH media the length was measured from. The shared
    // reader (`editPlanSourceDurationSec`) trusts the length only while that is
    // still the node's media — so a writer that bypasses this builder (a copilot
    // patch, an MCP workflow-JSON write, an import) cannot make it lie.
    metadata: seconds !== undefined && audioUrl ? { durationSeconds: seconds, mediaUrl: audioUrl } : undefined,
  }
}
