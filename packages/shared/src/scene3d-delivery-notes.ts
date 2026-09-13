/**
 * What a Scene3D authoring run says about its OWN answer, in the published result.
 *
 * An advanced authoring engine knows three things about the scene it just made that nothing
 * else can reconstruct afterwards: which parts of the brief it had to ASSUME, what it thinks it
 * authored, and how many repair passes it took to get there. All three ride the completed job's
 * `output_data`, in slots the delivery contract already had:
 *
 * | What | Where | Shape |
 * |---|---|---|
 * | the planner's assumptions, each with the engine's own normalizations prefixed | `validation.warnings[]` | one entry per assumption, `code` = {@link SCENE3D_AUTHORING_ASSUMPTION_CODE} |
 * | the planner's one-or-two-sentence description of what it authored (on a repaired run, of the REPAIR) | `metadata.summary` | string |
 * | repair passes actually RUN — never the authoring-pass count | `repairPasses` | top-level number |
 *
 * Every one of them is OPTIONAL, and absent is a first-class answer:
 *
 * - the deterministic Basic lane authors nothing with a model, so it carries none of them;
 * - a render-only export authored nothing either — it reports no `summary` and omits
 *   `repairPasses` entirely rather than claiming `0` about a run that never happened;
 * - a run whose recipe was refused on every pass has no composition to describe, so it carries
 *   the assumptions and `repairPasses` but NO `summary` and no `metadata` block to hold one;
 * - `repairPasses` is `0`, not absent, on a run that was accepted first time.
 *
 * Nothing here is new wire surface: the schemas that read these results are `.passthrough()`
 * and the fields were already arriving. Declaring them is what makes them visible to SDK
 * users, typed for a TypeScript caller, and documentable — instead of reachable only by
 * casting the result to `Record<string, unknown>`.
 */

/**
 * The `code` on a `validation.warnings[]` entry that is an authoring ASSUMPTION rather than a
 * reviewer finding — "the brief did not say, so the run decided". Consumers tell the two apart
 * by this code alone, without knowing anything about the engine that produced them.
 */
export const SCENE3D_AUTHORING_ASSUMPTION_CODE = "SCENE_AUTHORING_ASSUMPTION"

/** One advisory about a delivered scene. Same shape as `Pro3DRenderValidationWarning`. */
export interface Scene3DDeliveryWarning {
  /** `SCENE_AUTHORING_ASSUMPTION` for an authoring caveat; a `SCENE_QUALITY_*` code for a
   *  reviewer finding. Open-ended on purpose — an unknown code is shown, never refused. */
  code: string
  message: string
  /** The shot the advisory is about, when it is about exactly one. */
  shotId?: string
}

/**
 * The validation block an authoring lane publishes.
 *
 * Indexed on purpose: the block carries more than `warnings` (status, the pinned report, the
 * scope, and on a retained failure the pass count and phase), and a reader of THIS version
 * must keep reading those as it always did rather than have them typed away.
 */
export interface Scene3DAuthoringValidation {
  /** Advisories about the delivered scene, including the authoring assumptions. */
  warnings?: Scene3DDeliveryWarning[]
  [key: string]: unknown
}

/** The composition metadata block, plus the planner's own account of what it authored. */
export interface Scene3DAuthoringDeliveryMetadata {
  /**
   * The planner's one-or-two-sentence description of the scene it authored — on a repaired
   * run, of the repair it made. Routinely absent: a model that returns no summary is not an
   * error, and a lane that compiled nothing has nothing to describe.
   */
  summary?: string
  [key: string]: unknown
}

/**
 * The three additive fields every Scene3D AUTHORING delivery may carry. Mixed into the job
 * output types rather than repeated, so a lane that grows one grows all of them.
 */
export interface Scene3DAuthoringDelivery {
  /** Advisories about this result. Absent on the deterministic Basic lane. */
  validation?: Scene3DAuthoringValidation
  /** Composition metadata, including the planner's `summary`. */
  metadata?: Scene3DAuthoringDeliveryMetadata
  /**
   * Repair passes actually RUN, never the number of authoring passes: `0` on a scene accepted
   * first time, absent on a lane that authored nothing.
   */
  repairPasses?: number
}
