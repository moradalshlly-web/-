/**
 * "Auto" video duration — the model decides the clip length. The wire value is
 * KIE's own (`duration: -1`): on a video EDIT the output takes the source
 * clip's length, on any other run the model picks within its valid range.
 * Stored in the ordinary numeric `duration` field (node data, routes, presets,
 * MCP) so every surface that can carry a duration can carry Auto. Which models
 * accept it is a catalog capability (`MODEL_CATALOG[id].autoDuration`), read
 * through `supportsAutoVideoDuration`.
 *
 * Import-free on purpose: the catalog and the constants module both need it,
 * and they already depend on each other.
 */
export const VIDEO_DURATION_AUTO = -1

export function isAutoVideoDuration(duration: unknown): boolean {
  const n = typeof duration === "string" ? parseInt(duration, 10) : duration
  return n === VIDEO_DURATION_AUTO
}
