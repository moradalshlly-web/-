/**
 * Replicate failure → honest user-facing sentence.
 *
 * A Replicate model that dies inside its own forward pass reports a PyTorch
 * exception, not a verdict: the SDK throws `Prediction failed: <that text>` on
 * the worker lane, and `reconcile/replicate.ts` writes the generic
 * "Generation failed on the provider. Please try again." on the recovery lane.
 * Both readings are wrong when the model is telling us, in library vocabulary,
 * that the USER'S INPUT produced nothing to work on — retrying the identical
 * request then costs GPU time and a second wait for the same outcome.
 *
 * This module is the ONE place that translates those signatures, so the two
 * lanes cannot disagree about what a given failure means.
 *
 * Deliberately job-type-scoped: a PyTorch reshape error is a generic string
 * that any model can emit for any reason, so it is only read as "nothing
 * matched" for the job type whose model is known to fail that exact way.
 */

/**
 * Grounded SAM (schananas/grounded_sam) with ZERO detections.
 *
 * Grounding DINO returns an empty box tensor, and the SAM stage then reshapes
 * it: `cannot reshape tensor of 0 elements into shape [0, -1, 256, 256]
 * because the unspecified dimension size -1 can be any value and is
 * ambiguous`. Production evidence: two generate-mask jobs, 2026-09-08, both
 * carrying long descriptive noun clauses as the mask prompt — the phrasing
 * Grounding DINO's text encoder is weakest on.
 *
 * Matched on the structural part (0 elements + a reshape), not the exact
 * shape tuple, so a different mask resolution still matches.
 */
const EMPTY_DETECTION_RE = /cannot reshape tensor of 0 elements/i

/**
 * What the user can actually DO about it.
 *
 * NOT "lower the threshold": the node's Threshold slider is a no-op on the
 * pinned model (`schananas/grounded_sam` exposes no box-threshold input — see
 * grounded-sam.ts and docs/nodes/ai-image/generate-mask.md), so naming it
 * would send the user to a lever that changes nothing. A shorter, plainer
 * subject phrase is the lever that exists.
 *
 * Reads as non-retryable to `lib/mcp/tools/_job-error.ts` via the "no region
 * matched" fragment, and matches none of the content-rejection vocabulary —
 * this is a no-match, not a policy block.
 */
export const MASK_NO_REGION_MESSAGE =
  "No region matched the mask prompt. Try a shorter, plainer subject phrase " +
  '(for example "the hat" rather than a long description) and run again.'

/**
 * The honest user-facing sentence for a failed Replicate prediction, or `null`
 * when this module has nothing better to say than the caller's own default.
 *
 * `rawError` is the provider's own text — `prediction.error` on the reconcile
 * lane, the thrown `Error.message` on the worker lane. Never returned to the
 * user as-is; only used to recognise a signature.
 */
export function replicateFailureMessage(
  jobType: string | null | undefined,
  rawError: string | null | undefined,
): string | null {
  if (typeof rawError !== "string" || rawError.length === 0) return null
  if (jobType === "generate-mask" && EMPTY_DETECTION_RE.test(rawError)) {
    return MASK_NO_REGION_MESSAGE
  }
  return null
}

/**
 * A Replicate failure whose user-facing sentence we chose, carrying the
 * provider's raw text for the operator.
 *
 * `internalDetails` is the duck-typed field `lib/provider-error-detail.ts ::
 * providerDetailOf` reads (the same shape `KieError` / `ApifyError` carry) —
 * without it the worker lane would write our friendly sentence and NO
 * `error_detail`, losing the only record of what the model actually said.
 */
export class ReplicateSanitizedError extends Error {
  public readonly internalDetails: string

  constructor(message: string, internalDetails: string) {
    super(message)
    this.name = "ReplicateSanitizedError"
    this.internalDetails = internalDetails
  }
}
