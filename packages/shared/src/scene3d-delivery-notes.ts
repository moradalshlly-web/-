/**
 * What a Scene3D authoring run says about its OWN answer, in the published result.
 *
 * An advanced authoring engine knows things about the scene it just made that nothing else can
 * reconstruct afterwards: which parts of the brief it had to ASSUME, what it thinks it authored,
 * what it spent getting there, and — when the scene was delivered over the visual reviewer's
 * objection — what that reviewer wanted changed. All of it rides the completed job's
 * `output_data`, in slots the delivery contract already had:
 *
 * | What | Where | Shape |
 * |---|---|---|
 * | the planner's assumptions, each with the engine's own normalizations prefixed | `validation.warnings[]` | one entry per assumption, `code` = {@link SCENE3D_AUTHORING_ASSUMPTION_CODE} |
 * | the planner's one-or-two-sentence description of what it authored (on a repaired run, of the REPAIR) | `metadata.summary` | string |
 * | repair passes actually RUN — never the authoring-pass count | `repairPasses` | top-level number |
 * | pre-build planner retries that did NOT spend a repair pass | `admissionRetries` | top-level number |
 * | the visual reviewer's refusal of a scene that was delivered anyway | `metadata.review` + `validation.warnings[]` | {@link Scene3DReviewVerdict}, plus one entry per objection coded {@link SCENE3D_REVIEW_REFUSED_CODE} |
 *
 * Every one of them is OPTIONAL, and absent is a first-class answer:
 *
 * - the deterministic Basic lane authors nothing with a model, so it carries none of them;
 * - a render-only export authored nothing either — it reports no `summary` and omits
 *   `repairPasses` entirely rather than claiming `0` about a run that never happened;
 * - a run whose recipe was refused on every pass has no composition to describe, so it carries
 *   the assumptions and `repairPasses` but NO `summary` and no `metadata` block to hold one;
 * - `repairPasses` is `0`, not absent, on a run that was accepted first time;
 * - `admissionRetries` is absent on a run that never had one, and counts only the pre-build
 *   planner retries — a slip the compiler would not admit, re-asked without spending a repair;
 * - `review` is present ONLY on an advisory delivery (below). A scene the reviewer accepted, or
 *   never looked at, carries no `review` at all — absent means "nothing to report", never "passed
 *   silently".
 *
 * ## The advisory delivery
 *
 * The visual reviewer's refusal drives a repair for as long as the repair budget lasts. Once the
 * budget is spent, a scene whose every MANDATORY assertion passed is delivered rather than
 * withheld: the job completes, the video is real, and the refusal rides along as
 * {@link Scene3DAuthoringDeliveryMetadata.review} plus one `SCENE_REVIEW_REFUSED` warning per
 * objection. `validation.status` stays `"passed"` on such a result — the assertions DID pass —
 * so the presence of `review` is the only thing that tells an advisory delivery apart from a
 * clean one. A caller that wants the stricter reading tests for it explicitly.
 *
 * A refusal that raised NO objection is still a verdict, and still arrives: `objections: []` says
 * the reviewer refused without naming anything actionable, which an absent field would hide.
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
  /**
   * `SCENE_AUTHORING_ASSUMPTION` for an authoring caveat; `SCENE_REVIEW_REFUSED` for one
   * objection the reviewer raised against a scene that was DELIVERED anyway; a
   * `SCENE_QUALITY_*` code for a reviewer finding on a job that FAILED. Open-ended on
   * purpose — an unknown code is shown, never refused.
   */
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
  /**
   * The visual reviewer's whole verdict, present ONLY on an advisory delivery — a scene
   * whose mandatory assertions all passed, delivered once the repair budget was spent and
   * the reviewer still objected. Absent on every other result, including a clean one.
   */
  review?: Scene3DReviewVerdict
  [key: string]: unknown
}

/**
 * The additive fields every Scene3D AUTHORING delivery may carry. Mixed into the job output
 * types rather than repeated, so a lane that grows one grows all of them.
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
  /**
   * Pre-build planner retries, counted separately from {@link repairPasses} because they cost a
   * different thing: a recipe the compiler would not ADMIT is re-asked of the planner without a
   * build, so no repair pass was spent on it. Absent on a run that needed none and on a lane
   * that authored nothing.
   */
  admissionRetries?: number
}

/**
 * The `code` on a `validation.warnings[]` entry that is one objection the visual reviewer raised
 * against a scene that was DELIVERED anyway.
 *
 * Distinct from the `SCENE_QUALITY_*` codes on purpose: those appear on a job that FAILED, where
 * the finding is the reason there is no video. This one appears on a job that COMPLETED, where
 * the video is real and the finding is advice about it. One entry per objection, carrying the
 * `shotId` when every frame the objection cites falls inside one shot.
 */
export const SCENE3D_REVIEW_REFUSED_CODE = "SCENE_REVIEW_REFUSED"

/**
 * One thing the visual reviewer wanted changed, with the frames it was looking at.
 *
 * There is no `severity` here because severity is the FILTER, not a field: only the reviewer's
 * blocking findings become objections, so every entry in this list is blocking by construction.
 */
export interface Scene3DReviewObjection {
  /** The reviewer's own category for the finding, e.g. `"evidence"`. Open-ended. */
  category: string
  /** What is wrong — the finding's own description, never the reviewer's summary. */
  what: string
  /** The recipe-level change the reviewer asked for. Absent when it named none. */
  correction?: string
  /** The frames it cited, in the order the report gave them. Empty when it cited none. */
  frames: number[]
}

/**
 * The visual reviewer's verdict on a scene that was delivered over its objection.
 *
 * `verdict` is `"refused"` and only `"refused"`: an ACCEPTED review produces no verdict at all,
 * because a result that carries this field is by definition one the reviewer did not accept.
 * Declared as a literal rather than a union so a reader that checks it gets a compile-time answer
 * instead of a runtime one.
 */
export interface Scene3DReviewVerdict {
  verdict: "refused"
  /**
   * Every blocking finding across the run's reviews, de-duplicated. May be EMPTY: a refusal that
   * named nothing actionable is still a refusal, and `[]` reports it honestly.
   */
  objections: Scene3DReviewObjection[]
  /** The reviewer's own account of what it found CORRECT. Never a substitute for an objection. */
  observed?: string
}

/**
 * Whether a delivered result was an ADVISORY delivery — accepted by every mandatory assertion,
 * refused by the visual reviewer, published anyway.
 *
 * The one reader every surface should use, because the discriminant is easy to get wrong:
 * `validation.status` is `"passed"` on such a result (the assertions did pass), and the warning
 * array may legitimately hold zero `SCENE_REVIEW_REFUSED` entries for a refusal that raised no
 * objection. The presence of the verdict is the only reliable test.
 */
export function scene3DReviewVerdictOf(output: unknown): Scene3DReviewVerdict | undefined {
  const review = (output as { metadata?: { review?: unknown } } | null | undefined)?.metadata?.review
  if (typeof review !== "object" || review === null) return undefined
  const candidate = review as { verdict?: unknown; objections?: unknown; observed?: unknown }
  if (candidate.verdict !== "refused") return undefined
  const objections = (Array.isArray(candidate.objections) ? candidate.objections : [])
    .flatMap((entry): Scene3DReviewObjection[] => {
      if (typeof entry !== "object" || entry === null) return []
      const objection = entry as Record<string, unknown>
      if (typeof objection.what !== "string" || !objection.what) return []
      const frames = (Array.isArray(objection.frames) ? objection.frames : [])
        .filter((frame): frame is number => Number.isSafeInteger(frame) && frame >= 0)
      return [{
        category: typeof objection.category === "string" && objection.category ? objection.category : "unsupported",
        what: objection.what,
        ...(typeof objection.correction === "string" && objection.correction ? { correction: objection.correction } : {}),
        frames,
      }]
    })
  return {
    verdict: "refused",
    objections,
    ...(typeof candidate.observed === "string" && candidate.observed ? { observed: candidate.observed } : {}),
  }
}
