import { describe, expect, expectTypeOf, it } from "vitest"
import {
  SCENE3D_REVIEW_REFUSED_CODE,
  scene3DReviewVerdictOf,
  type Scene3DAuthoringValidation,
  type Scene3DReviewVerdict,
} from "../scene3d-delivery-notes.js"
import { pro3DRenderReviewVerdictSchema } from "../pro-3d-render.js"

/**
 * The advisory delivery is the one Scene3D outcome a caller CANNOT infer from the fields it
 * already reads: the job completed, `videoUrl` is real, and `validation.status` is `"passed"`.
 * Only `metadata.review` says the visual reviewer refused the scene anyway. These tests pin the
 * two ways that fact gets read wrong — off the status, or off the warning count.
 */
describe("scene3DReviewVerdictOf", () => {
  const verdict: Scene3DReviewVerdict = {
    verdict: "refused",
    objections: [
      { category: "motion", what: "The suitcase does not cross the frame.", correction: "Extend the keyframe span.", frames: [0, 4] },
    ],
    observed: "The frames establish a central square pillar.",
  }

  it("reads the verdict off a delivered result whose validation still says passed", () => {
    const output = {
      videoUrl: "https://example.invalid/scene.mp4",
      validation: { status: "passed", warnings: [{ code: SCENE3D_REVIEW_REFUSED_CODE, message: "motion: …" }] },
      metadata: { width: 1920, height: 1080, review: verdict },
    }
    expect(scene3DReviewVerdictOf(output)).toEqual(verdict)
  })

  it("is undefined for a clean delivery, so absence means nothing to report", () => {
    expect(scene3DReviewVerdictOf({ metadata: { width: 1920 }, validation: { status: "passed", warnings: [] } })).toBeUndefined()
  })

  /** A refusal that named nothing actionable is the shape that makes a critic useless; losing
   *  it would make it indistinguishable from a clean run. */
  it("keeps a refusal that raised no objection at all", () => {
    const empty = scene3DReviewVerdictOf({ metadata: { review: { verdict: "refused", objections: [] } } })
    expect(empty).toEqual({ verdict: "refused", objections: [] })
  })

  it("never invents a verdict from a warning, a status, or a malformed review", () => {
    expect(scene3DReviewVerdictOf({ validation: { warnings: [{ code: SCENE3D_REVIEW_REFUSED_CODE, message: "x" }] } })).toBeUndefined()
    expect(scene3DReviewVerdictOf({ validation: { status: "failed" } })).toBeUndefined()
    expect(scene3DReviewVerdictOf({ metadata: { review: { verdict: "accepted", objections: [] } } })).toBeUndefined()
    expect(scene3DReviewVerdictOf({ metadata: { review: "refused" } })).toBeUndefined()
    expect(scene3DReviewVerdictOf(null)).toBeUndefined()
    expect(scene3DReviewVerdictOf(undefined)).toBeUndefined()
  })

  /** Objections arrive from a model's report through JSON; a half-formed one must degrade to a
   *  readable entry rather than take the whole delivered scene down with it. */
  it("drops an objection with no text and defaults the rest rather than refusing the verdict", () => {
    const read = scene3DReviewVerdictOf({
      metadata: { review: { verdict: "refused", objections: [
        { category: "", what: "Lighting is flat.", frames: [2, -1, "x", 7] },
        { category: "motion" },
        "not an objection",
      ], observed: "" } },
    })
    expect(read).toEqual({
      verdict: "refused",
      objections: [{ category: "unsupported", what: "Lighting is flat.", frames: [2, 7] }],
    })
  })
})

describe("pro3DRenderReviewVerdictSchema", () => {
  it("parses the verdict the plugin emits, keys and all", () => {
    const parsed = pro3DRenderReviewVerdictSchema.safeParse({
      verdict: "refused",
      objections: [{ category: "evidence", what: "Could not establish the motion.", frames: [0], extra: 1 }],
      observed: "A red suitcase.",
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts an objection that cited no frames, and refuses a verdict that is not a refusal", () => {
    expect(pro3DRenderReviewVerdictSchema.safeParse({
      verdict: "refused", objections: [{ category: "style", what: "Too dark." }],
    }).success).toBe(true)
    expect(pro3DRenderReviewVerdictSchema.safeParse({ verdict: "accepted", objections: [] }).success).toBe(false)
  })
})

/**
 * `validation.sourceRetained` — the refused-authoring row's one pointer at something fetchable.
 *
 * A run whose recipe never compiled publishes no scene revision and no poster, so nothing on
 * the failed row is a scene. What it can say is whether the recipe it was refused for was kept,
 * which decides whether `GET /v1/3d-scene/deliveries/{deliveryId}` has a `source-json`
 * descriptor to list. Declared rather than merely tolerated by the index signature, so a typed
 * caller can read it without casting — and so it appears in the generated SDK docs at all.
 */
describe("Scene3DAuthoringValidation.sourceRetained", () => {
  it("is a typed optional beside the fields the same block already carried", () => {
    const refused: Scene3DAuthoringValidation = {
      status: "failed", scope: "authored", phase: "build", passes: 3,
      reportAssetId: "report-1", sourceRetained: true,
      warnings: [{ code: "SCENE_RECIPE_INVALID", message: "camera.shots[0].target is not resolvable" }],
    }
    expectTypeOf(refused.sourceRetained).toEqualTypeOf<boolean | undefined>()
    expect(refused.sourceRetained).toBe(true)
    // Absent is a first-class answer everywhere in this block: every lane that DID compile
    // carries no such flag, because there is no refused recipe to have retained.
    const delivered: Scene3DAuthoringValidation = { status: "passed", reportAssetId: "report-2", warnings: [] }
    expect(delivered.sourceRetained).toBeUndefined()
  })

  it("is false, not absent, on a run that never cleared admission", () => {
    // No pass produced a recipe the compiler would admit, so there is nothing to fetch. `false`
    // says that; absent would leave a caller unable to tell it from an older deployment.
    const refused: Scene3DAuthoringValidation = {
      status: "failed", scope: "authored", phase: "planning", passes: 2,
      reportAssetId: "report-3", sourceRetained: false, warnings: [],
    }
    expect(refused.sourceRetained).toBe(false)
  })
})
