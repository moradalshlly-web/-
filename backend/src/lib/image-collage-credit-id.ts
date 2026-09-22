/**
 * Image Collage prices by output RESOLUTION, through the composite rows
 * `image-collage:2K` / `image-collage:4K` in the price table (migration 288,
 * `STATIC_CREDIT_COSTS`). ONE identifier builder for the single-node route's
 * credit guard + reservation and the workflow-run reservation
 * (payload-builder), so the two paths cannot price the same render apart.
 *
 * History: the route carried its own `computeCredits` hook returning 2 / 4 —
 * BASE credits typed by hand, which the 2026-07-30 ×10 re-denomination never
 * reached — so a single-node collage reserved a tenth of what a workflow run
 * reserved for the same output.
 *
 * An unknown / absent resolution prices as 4K: that is the route's own Zod
 * default, and the guard reads the raw body before Zod runs.
 */
export function imageCollageCreditModelIdentifier(resolution: unknown): "image-collage:2K" | "image-collage:4K" {
  return resolution === "2K" ? "image-collage:2K" : "image-collage:4K"
}
