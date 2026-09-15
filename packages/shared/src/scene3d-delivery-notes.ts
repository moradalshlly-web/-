/**
 * What a Scene3D authoring run says about its OWN answer, in the published result.
 *
 * An advanced authoring engine knows things about the scene it just made that nothing else can
 * reconstruct afterwards: which parts of the brief it had to ASSUME, what it thinks it authored,
 * what it spent getting there, and — when the scene was delivered without the visual reviewer's
 * approval — what that reviewer wanted changed, or that it gave no usable verdict at all. All of it
 * rides the completed job's `output_data`, in slots the delivery contract already had:
 *
 * | What | Where | Shape |
 * |---|---|---|
 * | the planner's assumptions, each with the engine's own normalizations prefixed | `validation.warnings[]` | one entry per assumption, `code` = {@link SCENE3D_AUTHORING_ASSUMPTION_CODE} |
 * | the planner's one-or-two-sentence description of what it authored (on a repaired run, of the REPAIR) | `metadata.summary` | string |
 * | repair passes actually RUN — never the authoring-pass count | `repairPasses` | top-level number |
 * | pre-build planner retries that did NOT spend a repair pass | `admissionRetries` | top-level number |
 * | repairs the engine applied from the compiler's OWN remedy, on their own quoted allowance | `mechanicalPasses` | top-level number, counted APART from `repairPasses` |
 * | the per-remedy account of what one of those applied | `validation.warnings[]` | one entry per remedy, `code` = {@link SCENE3D_REMEDY_AUTO_APPLIED_CODE} |
 * | mandatory assertions the engine put BACK after a planner answer re-shaped them | `restoredAssertions` | array of {@link Scene3DRestoredAssertion} |
 * | the per-assertion account of one of those restores | `validation.warnings[]` | one entry per restore, `code` = {@link SCENE3D_ASSERTION_RESTORED_CODE} |
 * | the visual reviewer's refusal of a scene that was delivered anyway | `metadata.review` + `validation.warnings[]` | {@link Scene3DReviewVerdict} with `verdict: "refused"`, plus one entry per objection coded {@link SCENE3D_REVIEW_REFUSED_CODE} |
 * | that the review produced no usable verdict at all — its provider was never reached, or answered unusably — and the scene was delivered unreviewed | `metadata.review` + `validation.warnings[]` | {@link Scene3DReviewVerdict} with `verdict: "unavailable"` and a `reason` from {@link SCENE3D_REVIEW_UNAVAILABLE_REASONS}, plus one LEADING entry coded {@link SCENE3D_REVIEW_UNAVAILABLE_CODE} |
 *
 * Every one of them is OPTIONAL, and absent is a first-class answer:
 *
 * - the deterministic Basic lane authors nothing with a model, so it carries none of them;
 * - a render-only export authored nothing either — it reports no `summary` and omits
 *   `repairPasses` entirely rather than claiming `0` about a run that never happened;
 * - a run whose recipe was refused on every pass has no composition to describe, so it carries
 *   the assumptions and `repairPasses` but NO `summary` and no `metadata` block to hold one;
 *   what it DOES carry is {@link Scene3DAuthoringValidation.sourceRetained}, saying whether the
 *   recipe it was refused for is retrievable from its delivery;
 * - `repairPasses` is `0`, not absent, on a run that was accepted first time;
 * - `admissionRetries` is absent on a run that never had one, and counts only the pre-build
 *   planner retries — a slip the compiler would not admit, re-asked without spending a repair;
 * - `mechanicalPasses` is counted APART from `repairPasses`, the same way `admissionRetries` is,
 *   because it buys a different thing and is BOUGHT differently: a mandatory finding that carries
 *   the compiler's own structured remedy is answered by applying that remedy and rebuilding, with
 *   no planner call, and those passes have their own quoted allowance — a `mechanical` line on the
 *   quote, released when unspent — rather than spending one of the caller's repairs. So they are
 *   never folded into `repairPasses`, and the pass identity the pricing keeps is
 *   `buildPasses === authoringPasses + repairPasses + mechanicalPasses`. Absent on a run that took
 *   none and on an engine that does not report it, so absent is never evidence that the planner
 *   authored every repair;
 * - the ONE exception is a run quoted BEFORE that allowance existed. Its quote carries no
 *   `mechanical` line, and there the older accounting still holds: the pass charged a repair, so
 *   the count is a SUBSET of `repairPasses` rather than a sibling of it. The discriminant is the
 *   quote, not the result — the result reports the same field either way — so a reader that must
 *   know which accounting applies reads the quote it was given rather than inferring one;
 * - `review` is present ONLY on a delivery the reviewer did not APPROVE (below) — one it refused,
 *   or one it never got to judge because its provider could not be reached. A scene the reviewer
 *   accepted carries no `review` at all — absent means "nothing to report", never "passed
 *   silently", and never "nobody looked".
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
 * ## The UNREVIEWED delivery
 *
 * The second way a scene is delivered without approval: the review produced no usable verdict.
 * That is the advisory situation with a different cause, and it differs in exactly one way — a
 * repair answers an objection, and a missing opinion raises none, so waiting for the repair budget
 * to run out buys nothing. The review is asked once more — after a bounded pause when its provider
 * was unreachable, at once when it answered unusably, and not at all when a provider broke after it
 * had already reported usage — and if there is still no usable answer, the assertion-passing scene
 * is delivered immediately with `{ verdict: "unavailable", reason, attempts }` on {@link
 * Scene3DAuthoringDeliveryMetadata.review}, and `validation.warnings[]` LEADS with one
 * `SCENE_REVIEW_UNAVAILABLE` entry. `reason` is one of {@link SCENE3D_REVIEW_UNAVAILABLE_REASONS}:
 * `"provider"` when no asking reached the provider, `"unusable"` when one did and answered with
 * nothing usable. `attempts` is how many times the review was asked, so one unlucky call is
 * distinguishable from a provider that was down for the whole minute.
 *
 * `objections` may still be non-empty on that arm. A review is BATCHED, and batches that answered
 * before the provider went away are evidence a caller is entitled to; each arrives as a
 * `SCENE_REVIEW_REFUSED` warning UNDER the leading one, which qualifies every line below it. A
 * caller reading only `objections: []` would otherwise take the silence for approval.
 *
 * With the advisory policy off, that scene is RETAINED as a draft on a `failed` job instead of
 * delivered. There is no `metadata.review` on that lane — a retained failure publishes no
 * metadata block — and the `SCENE_REVIEW_UNAVAILABLE` warning is what says nobody judged it. The
 * pinned validation report says `review: "unavailable"` on both lanes.
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
   * objection the reviewer raised against a scene that was DELIVERED anyway;
   * `SCENE_REVIEW_UNAVAILABLE` for a scene delivered or retained with NO reviewer verdict at all,
   * because the review's provider never answered or answered unusably — it leads the array when it
   * is there;
   * `REMEDY_AUTO_APPLIED` for one remedy the engine applied itself on a mechanical repair;
   * `ASSERTION_RESTORED` for one mandatory assertion it put back after a planner answer
   * re-shaped it; a `SCENE_QUALITY_*` code for a reviewer finding on a job that FAILED.
   * Open-ended on purpose — an unknown code is shown, never refused.
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
  /**
   * Whether a run that never COMPILED kept its last admitted recipe.
   *
   * Present only on the refused-authoring shape — a job that failed with no `scenePlan` and no
   * `sceneRevisionId`, because the compiler refused the recipe on every pass. `true` means the
   * recipe is retrievable: `GET /v1/3d-scene/deliveries/{deliveryId}` lists a `source-json`
   * descriptor beside the refusal report, and its bytes come back from the delivery assets
   * route, to a caller with `edit` on the job's workflow. `false` means no pass ever cleared
   * admission, so there is no recipe to fetch — only the report.
   *
   * A row-level flag rather than only a descriptor, because it answers "is there anything to
   * fetch" without a round trip, and answers it honestly when the caller's access would hide
   * the descriptor anyway.
   */
  sourceRetained?: boolean
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
   * The visual reviewer's whole verdict, present ONLY on a delivery it did not approve — a scene
   * whose mandatory assertions all passed, delivered either once the repair budget was spent and
   * the reviewer still objected (`verdict: "refused"`), or without any verdict at all because the
   * review's provider could not be reached (`verdict: "unavailable"`). Absent on every other
   * result, including a clean one. Read it with {@link scene3DReviewVerdictOf} rather than by
   * hand, and render it with {@link scene3DReviewNote}.
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
  /**
   * Repairs the engine authored ITSELF, from the compiler's own structured remedy, without asking
   * the planner.
   *
   * Counted APART from {@link repairPasses} and never folded into it — the same way
   * {@link admissionRetries} is — because these passes have their own quoted allowance: a
   * `mechanical` line on the quote, bounded and released when unspent, rather than one of the
   * caller's repairs. The pass identity the pricing keeps is
   * `buildPasses === authoringPasses + repairPasses + mechanicalPasses`.
   *
   * ONE exception, and the discriminant is the QUOTE rather than this result: a run quoted before
   * that allowance existed carries no `mechanical` quote line, and there the older accounting
   * still holds — the pass charged a repair, so the count is a subset of {@link repairPasses}.
   * The result reports the same field either way, so a reader that must know which accounting
   * applies reads the quote it was given rather than inferring one from the counts.
   *
   * Absent on a run that took none, on a lane that authored nothing, and on an engine that does
   * not report it — so absent means "not reported", never "the planner authored every repair".
   */
  mechanicalPasses?: number
  /**
   * Mandatory assertions the engine put BACK, each because a planner answer re-shaped one the
   * feedback had not named.
   *
   * A repair is invited to change what the feedback names and nothing else. When an answer
   * re-shapes a mandatory assertion outside that invitation, the engine restores it to the last
   * admitted recipe's exact form and carries on, instead of refusing the answer and spending a
   * retry to be told to put back a value it already held. An assertion the feedback DOES name is
   * left alone — re-shaping one you were invited to re-shape is a disagreement, not a slip.
   *
   * Each entry is also one `ASSERTION_RESTORED` warning. Absent on a run that restored nothing
   * and on an engine that does not report it; `[]` is possible and means the same thing.
   */
  restoredAssertions?: Scene3DRestoredAssertion[]
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
 * The `code` on the `validation.warnings[]` entry that says NOBODY reviewed this scene, because
 * the review produced no usable verdict: its provider never answered, or answered unusably (the
 * message says which, in the words {@link scene3DReviewNote} uses).
 *
 * Its own code rather than a {@link SCENE3D_REVIEW_REFUSED_CODE} with an apologetic message:
 * "the reviewer objected to X" and "there is no reviewer verdict at all" are different facts
 * about the scene a caller is holding, and only the second one is answered by running the job
 * again later.
 *
 * It LEADS the warning array wherever it appears, because it qualifies every line under it — an
 * objection below it came from a review that never finished, and a reader shown only the
 * objection would take the silence on everything else for approval. It appears on the DELIVERED
 * lane beside `metadata.review`, and on the RETAINED failure lane, which publishes no metadata
 * block and where this warning is therefore the only thing that says nobody judged the draft.
 */
export const SCENE3D_REVIEW_UNAVAILABLE_CODE = "SCENE_REVIEW_UNAVAILABLE"

/**
 * The `code` on a `validation.warnings[]` entry that records one remedy the engine applied ITSELF
 * — a mechanical repair, counted by {@link Scene3DAuthoringDelivery.mechanicalPasses}.
 *
 * Written down here for the same reason the other two codes are: so a consumer that wants to tell
 * "the platform fixed this from the compiler's own instruction" apart from "the planner was asked"
 * has one place to read the string from, rather than spelling it at each call site. The entry
 * names the assertion that refused the build, the ops applied, and the measurement before them.
 */
export const SCENE3D_REMEDY_AUTO_APPLIED_CODE = "REMEDY_AUTO_APPLIED"

/**
 * The `code` on a `validation.warnings[]` entry that records one mandatory assertion the engine
 * RESTORED after a planner answer re-shaped it without being asked to.
 *
 * Distinct from {@link SCENE3D_REMEDY_AUTO_APPLIED_CODE}: that one says the engine changed the
 * SCENE to satisfy an assertion, this one says it changed the ANSWER back to leave an assertion
 * as it was. Both appear on runs that completed normally — neither is a failure.
 */
export const SCENE3D_ASSERTION_RESTORED_CODE = "ASSERTION_RESTORED"

/**
 * One mandatory assertion put back to its last admitted form, with the edit that did it.
 *
 * Read tolerantly and declared loosely on purpose: `op` and `path` describe an edit in the
 * engine's own vocabulary rather than a format this package pins, and `value` is whatever the
 * restored assertion holds — a number, a string, an object — so it is `unknown` rather than
 * narrowed to whatever today's assertions happen to use.
 */
export interface Scene3DRestoredAssertion {
  /** The edit applied to put it back, in the engine's vocabulary (e.g. `"replace"`). */
  op: string
  /** Where in the recipe it was put back. */
  path: string
  /** The restored value. Absent for an edit that carries none, such as a removal. */
  value?: unknown
  /** The assertion's own id, the same one the refusal would have named. */
  assertionId: string
  /** Why it was restored, in the engine's words. Open-ended; shown, never matched on. */
  reason: string
}

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
 * What every verdict carries, whichever way the review ended.
 *
 * Shared by both arms of {@link Scene3DReviewVerdict} so a consumer that only wants the findings
 * can take this type and stay indifferent to why the review did not approve the scene.
 */
export interface Scene3DReviewFindings {
  /**
   * Every blocking finding across the run's reviews, de-duplicated. May be EMPTY: a refusal that
   * named nothing actionable is still a refusal, and `[]` reports it honestly. On the
   * `"unavailable"` arm it holds whichever review BATCHES answered usably before the one that did
   * not, and is `[]` in the common case where the first batch is the one that failed.
   */
  objections: Scene3DReviewObjection[]
  /** The reviewer's own account of what it found CORRECT. Never a substitute for an objection. */
  observed?: string
}

/** The reviewer answered, and objected. {@link Scene3DReviewFindings.objections} is what it wants changed. */
export type Scene3DReviewRefused = { verdict: "refused" } & Scene3DReviewFindings

/**
 * The review never produced an answer, so the scene was delivered with nobody's opinion on it.
 *
 * `objections` may still be non-empty here — see {@link Scene3DReviewFindings.objections} — which
 * is exactly why this is a distinct verdict rather than a refusal with a flag: the findings that
 * DID arrive are real, and the fact that they are not the whole verdict is the thing a caller
 * must not lose.
 */
export type Scene3DReviewUnavailable = {
  verdict: "unavailable"
  /**
   * Why the verdict is missing — one of {@link SCENE3D_REVIEW_UNAVAILABLE_REASONS}. `"provider"`:
   * the review never reached its provider. `"unusable"`: it was reached, and answered with nothing
   * usable. The delivery is the same unreviewed scene either way; the reason changes the sentence
   * ({@link scene3DReviewNote}), because "did not reach its provider" is untrue of a provider that
   * answered.
   */
  reason: Scene3DReviewUnavailableReason
  /**
   * How many times the review was ASKED — the call plus its retry, so `2` on the common outage and
   * on an unusable answer. `1` when a provider broke after it had already reported usage: that
   * asking was paid, so it is not asked a second time. Always a positive integer.
   */
  attempts: number
} & Scene3DReviewFindings

/**
 * Every cause a {@link Scene3DReviewUnavailable} verdict can name, written down ONCE.
 *
 * The reader schema (`pro3DRenderReviewVerdictSchema`), {@link scene3DReviewVerdictOf} and
 * {@link scene3DReviewNote} all read this list rather than spelling their own, so a cause the
 * engine adds is taught here and nowhere else. A wire value NOT in it is read as `"provider"` by
 * both tolerant readers — the only cause an older engine emits — instead of discarding a verdict
 * on a scene that was delivered and paid for.
 *
 * - `"provider"` — the review never reached its provider: an outage, or a call that broke before it
 *   produced an answer.
 * - `"unusable"` — at least one asking REACHED the provider, and no asking got a usable answer
 *   back: an answer that failed the review contract, one that cited a frame the batch never
 *   supplied, or a host refusal that is not a transport fault.
 */
export const SCENE3D_REVIEW_UNAVAILABLE_REASONS = ["provider", "unusable"] as const

/** One of {@link SCENE3D_REVIEW_UNAVAILABLE_REASONS}. */
export type Scene3DReviewUnavailableReason = (typeof SCENE3D_REVIEW_UNAVAILABLE_REASONS)[number]

/** Whether a wire value is a reason this package knows. The one guard both tolerant readers share. */
export function isScene3DReviewUnavailableReason(value: unknown): value is Scene3DReviewUnavailableReason {
  return (SCENE3D_REVIEW_UNAVAILABLE_REASONS as readonly unknown[]).includes(value)
}

/**
 * The visual reviewer's verdict on a scene that was delivered WITHOUT its approval.
 *
 * `verdict` is the discriminant, and it is the only one: an ACCEPTED review produces no verdict
 * at all, because a result that carries this field is by definition one the reviewer did not
 * approve. The two arms say WHY it did not — it objected, or it gave no usable answer — and a consumer
 * that switches on `verdict` gets a compile-time answer for both.
 *
 * Deliberately NOT a second `status` field beside `verdict`: a caller written against the
 * refused-only shape needs one new arm and no re-typing of the arm it already has.
 */
export type Scene3DReviewVerdict = Scene3DReviewRefused | Scene3DReviewUnavailable

/**
 * Whether a delivered result was published WITHOUT the visual reviewer's approval — accepted by
 * every mandatory assertion, and then either refused by that reviewer or never judged by it.
 *
 * The one reader every surface should use, because the discriminant is easy to get wrong:
 * `validation.status` is `"passed"` on such a result (the assertions did pass), and the warning
 * array may legitimately hold zero `SCENE_REVIEW_REFUSED` entries for a refusal that raised no
 * objection. The presence of the verdict is the only reliable test.
 *
 * Reading the `"unavailable"` arm is equally the point: a surface that checked
 * `verdict === "refused"` and stopped would show NOTHING for an unreviewed delivery, which is
 * indistinguishable from a clean one — the silence this whole module exists to prevent.
 *
 * Tolerant like the schemas that parse these results: an `attempts` that is not a positive
 * integer is clamped to `1` rather than discarding a verdict that is otherwise well-formed. A
 * verdict this cannot recognise at all returns `undefined`, which the caller reads as "no
 * verdict" — the same answer an older engine gives.
 */
export function scene3DReviewVerdictOf(output: unknown): Scene3DReviewVerdict | undefined {
  const review = (output as { metadata?: { review?: unknown } } | null | undefined)?.metadata?.review
  if (typeof review !== "object" || review === null) return undefined
  const candidate = review as {
    verdict?: unknown; objections?: unknown; observed?: unknown; reason?: unknown; attempts?: unknown
  }
  if (candidate.verdict !== "refused" && candidate.verdict !== "unavailable") return undefined
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
  const findings: Scene3DReviewFindings = {
    objections,
    ...(typeof candidate.observed === "string" && candidate.observed ? { observed: candidate.observed } : {}),
  }
  if (candidate.verdict === "refused") return { verdict: "refused", ...findings }
  const attempts = typeof candidate.attempts === "number" && Number.isSafeInteger(candidate.attempts)
    && candidate.attempts > 0 ? candidate.attempts : 1
  // Kept when it is a cause this package knows, and read as `"provider"` otherwise — the same
  // fallback the reader schema applies, so the two readers never disagree about one row.
  const reason = isScene3DReviewUnavailableReason(candidate.reason) ? candidate.reason : "provider"
  return { verdict: "unavailable", reason, attempts, ...findings }
}

/**
 * One user-safe sentence for a verdict, so the same run is never described two different ways.
 *
 * Written down once here for the reason the codes above are: a surface that spells this itself
 * gets it wrong on the arm it was not thinking about — a banner that reads "the reviewer refused
 * this scene" for a scene NO reviewer ever saw is worse than no banner, because it invents an
 * opinion. Callers that want their own wording still have the structured verdict; this is the
 * default they do not have to write.
 *
 * Phrased for the DELIVERED lane, which is the only lane `metadata.review` appears on: the
 * retained-draft lane publishes no metadata block, and says the same thing through its leading
 * {@link SCENE3D_REVIEW_UNAVAILABLE_CODE} warning instead.
 */
export function scene3DReviewNote(verdict: Scene3DReviewVerdict): string {
  if (verdict.verdict === "unavailable") {
    const asked = verdict.attempts === 1 ? "one attempt" : `${verdict.attempts} attempts`
    const partial = verdict.objections.length
      ? ` Part of the review did answer first, and its ${verdict.objections.length === 1
        ? "one finding is" : `${verdict.objections.length} findings are`} listed — but they are not the whole verdict.`
      : ""
    // The reason picks the clause, and nothing else: "did not reach its provider" is untrue of a
    // provider that answered, and the engine's own `SCENE_REVIEW_UNAVAILABLE` warning says the
    // same run in these same words, so a banner and the warning under it never disagree.
    const missing = verdict.reason === "unusable"
      ? `returned no usable verdict in ${asked}`
      : `did not reach its provider in ${asked}`
    return `The scene built and every mandatory assertion passed, but the visual review ${missing}; `
      + `it was delivered unreviewed.${partial}`
  }
  const count = verdict.objections.length
  if (!count) {
    return "The visual review refused this scene without naming anything to change; "
      + "it was delivered anyway because every mandatory assertion passed."
  }
  return `The visual review refused this scene on ${count === 1 ? "one finding" : `${count} findings`}; `
    + "it was delivered anyway because every mandatory assertion passed."
}
