/** Hebrew requires the separately priced project API. Keep dispatch and billing aligned. */
export function dubbingModelIdentifier(targetLanguage: unknown): string {
  return typeof targetLanguage === "string" && /^(he|heb)$/i.test(targetLanguage)
    ? "elevenlabs-dubbing-v2" : "elevenlabs-dubbing"
}
