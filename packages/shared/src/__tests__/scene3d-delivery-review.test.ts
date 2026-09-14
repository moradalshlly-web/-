import { describe, expect, expectTypeOf, it } from "vitest"
import {
  SCENE3D_ASSERTION_RESTORED_CODE,
  SCENE3D_REMEDY_AUTO_APPLIED_CODE,
  SCENE3D_REVIEW_REFUSED_CODE,
  scene3DReviewVerdictOf,
  type Scene3DAuthoringDelivery,
  type Scene3DAuthoringValidation,
  type Scene3DReviewVerdict,
} from "../scene3d-delivery-notes.js"
import { pro3DRenderJobOutputSchema, pro3DRenderReviewVerdictSchema } from "../pro-3d-render.js"
import { FIXTURE_FPS, FIXTURE_FRAMES, FIXTURE_HEIGHT, FIXTURE_WIDTH, planV2 } from "./scene3d-v2-fixtures.js"

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

/**
 * `mechanicalPasses` is counted APART from `repairPasses` — mechanical passes buy their own
 * allowance (a `mechanical` quote line, released when unspent) instead of spending one of the
 * caller's repairs. The trap this pins is that there is NO arithmetic relation between the two
 * numbers to lean on: a run may report more mechanical passes than repairs, and the older
 * accounting (where the count WAS a subset) is still reachable on a result quoted before the
 * allowance existed. The discriminant for which accounting applies is the QUOTE, and the result
 * does not carry it — so any reader deriving the relation from these two numbers is guessing.
 */
describe("Scene3DAuthoringDelivery.mechanicalPasses", () => {
  it("is a typed optional that carries no arithmetic relation to repairPasses", () => {
    // Two mechanical passes on a run that spent ONE repair: impossible under the old subset
    // reading, ordinary under its own allowance. This is the case a `<=` assertion would reject.
    const delivery: Scene3DAuthoringDelivery = {
      repairPasses: 1,
      mechanicalPasses: 2,
      validation: {
        status: "passed",
        reportAssetId: "report-1",
        warnings: [{
          code: SCENE3D_REMEDY_AUTO_APPLIED_CODE,
          message: "applied 1 remedy op for cyanVisibility: replace /camera/shots/1/lens/focalLengthMm = 30.8",
        }],
      },
    }
    expectTypeOf(delivery.mechanicalPasses).toEqualTypeOf<number | undefined>()
    expect(delivery.mechanicalPasses).toBe(2)
    expect(delivery.repairPasses).toBe(1)
    expect(delivery.validation?.warnings?.[0]?.code).toBe("REMEDY_AUTO_APPLIED")
  })

  it("is absent, not zero, on a run that took none — and absent is not evidence of none", () => {
    // An engine that does not report the count is indistinguishable from a run that took none,
    // which is why no reader may default it to 0 and then claim the planner authored every repair.
    const planned: Scene3DAuthoringDelivery = { repairPasses: 1 }
    expect(planned.mechanicalPasses).toBeUndefined()
  })
})

/**
 * The answer-side restore. A repair may change what the feedback names; when an answer re-shapes a
 * mandatory assertion it was NOT invited to touch, the engine puts that assertion back rather than
 * refusing the answer and spending a retry to be told to restore a value it already held.
 */
describe("Scene3DAuthoringDelivery.restoredAssertions", () => {
  it("carries the edit that put one back, beside its ASSERTION_RESTORED warning", () => {
    const delivery: Scene3DAuthoringDelivery = {
      restoredAssertions: [{
        op: "replace",
        path: "/assertions/cyanEndVisibility",
        value: { kind: "visibility", minCoverage: 0.08 },
        assertionId: "cyanEndVisibility",
        reason: "the repair re-shaped a mandatory assertion the feedback does not name",
      }],
      validation: {
        status: "passed",
        reportAssetId: "report-2",
        warnings: [{ code: SCENE3D_ASSERTION_RESTORED_CODE, message: "restored cyanEndVisibility" }],
      },
    }
    expect(delivery.restoredAssertions?.[0]?.assertionId).toBe("cyanEndVisibility")
    // `value` is deliberately `unknown` — a restored assertion holds whatever it holds, and
    // narrowing it here would make the type wrong the first time an assertion shape changes.
    expectTypeOf(delivery.restoredAssertions![0]!.value).toEqualTypeOf<unknown>()
    expect(delivery.validation?.warnings?.[0]?.code).toBe("ASSERTION_RESTORED")
  })
})

/**
 * The reader schema is `.passthrough()`, so the field already ARRIVED before it was declared. What
 * declaring it buys is the refusal below: a negative or fractional count is a malformed result, and
 * an untyped passthrough key would have carried it to a caller unexamined.
 */
describe("pro3DRenderJobOutputSchema — mechanicalPasses", () => {
  // A REAL plan, from the shared fixture: a hand-rolled stub would fail `scenePlan` first and make
  // every refusal below pass for the wrong reason, proving nothing about this field.
  const base = {
    videoUrl: "https://cdn.example/scene.mp4",
    scenePlan: planV2(),
    sceneRevisionId: "rev-1",
    posterAssetId: "poster-1",
    validation: { status: "passed" as const, reportAssetId: "report-1", warnings: [] },
    renderer: "blender",
    metadata: {
      width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT, fps: FIXTURE_FPS,
      frames: FIXTURE_FRAMES, duration: FIXTURE_FRAMES / FIXTURE_FPS,
    },
  }

  it("the fixture itself parses, so a refusal below is about mechanicalPasses and nothing else", () => {
    expect(pro3DRenderJobOutputSchema.safeParse(base).success).toBe(true)
  })

  it("parses the count the engine emits, beside the repair count it is part of", () => {
    const parsed = pro3DRenderJobOutputSchema.safeParse({ ...base, repairPasses: 2, mechanicalPasses: 1 })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.mechanicalPasses).toBe(1)
  })

  it("refuses a count that cannot describe passes that were run", () => {
    expect(pro3DRenderJobOutputSchema.safeParse({ ...base, mechanicalPasses: -1 }).success).toBe(false)
    expect(pro3DRenderJobOutputSchema.safeParse({ ...base, mechanicalPasses: 1.5 }).success).toBe(false)
  })

  it("does not tie mechanicalPasses to repairPasses — more mechanical than repairs parses", () => {
    const parsed = pro3DRenderJobOutputSchema.safeParse({ ...base, repairPasses: 1, mechanicalPasses: 2 })
    expect(parsed.success).toBe(true)
  })

  it("parses a restored assertion, keeping an unknown value and unknown extra keys", () => {
    const parsed = pro3DRenderJobOutputSchema.safeParse({
      ...base,
      restoredAssertions: [{
        op: "replace", path: "/assertions/a1", value: { minCoverage: 0.08 },
        assertionId: "a1", reason: "not named by the feedback", frames: [0, 4],
      }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.restoredAssertions?.[0]?.assertionId).toBe("a1")
  })

  it("keeps an entry whose value is absent, and refuses one that names nothing", () => {
    // A removal carries no value; that entry is still a real restore.
    expect(pro3DRenderJobOutputSchema.safeParse({
      ...base,
      restoredAssertions: [{ op: "remove", path: "/assertions/a1", assertionId: "a1", reason: "r" }],
    }).success).toBe(true)
    // No assertionId: the entry cannot say WHAT was restored, so it is not a restore.
    expect(pro3DRenderJobOutputSchema.safeParse({
      ...base,
      restoredAssertions: [{ op: "replace", path: "/assertions/a1", reason: "r" }],
    }).success).toBe(false)
  })
})
