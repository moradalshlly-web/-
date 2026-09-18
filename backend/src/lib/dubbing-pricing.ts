import { dubbingModelIdentifier } from "./dubbing-model.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { validateProjectDubbing } from "../providers/elevenlabs/dubbing-project.js"
import { getAppSettings } from "./app-settings.js"

/** Workflow dispatch bypasses the HTTP route: apply the same per-minute rate
 * and validate the imported source before reserving, not after a paid start. */
export async function projectDubbingCreditOverride(jobName: string, payload: Record<string, unknown>): Promise<number | undefined> {
  if (jobName !== "dubbing" || dubbingModelIdentifier(payload.targetLanguage) !== "elevenlabs-dubbing-v2") return undefined
  const url = typeof payload.videoUrl === "string" ? payload.videoUrl : typeof payload.audioUrl === "string" ? payload.audioUrl : undefined
  validateProjectDubbing({ url }, payload)
  const seconds = await probeMediaDuration(url!)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1800) throw new Error("Hebrew dubbing requires a readable source no longer than 30 minutes.")
  payload.probedDurationSec = Math.ceil(seconds)
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  const { creditCost } = await getModelCreditBaseCost("elevenlabs-dubbing-v2")
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  return applyServiceMarkup(creditCost * Math.ceil(seconds / 60), await getAppSettings(), "elevenlabs-dubbing-v2")
}
