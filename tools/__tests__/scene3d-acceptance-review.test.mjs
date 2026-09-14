/**
 * The advisory delivery, from the harness's side.
 *
 * A scene the visual reviewer refused is still DELIVERED once the repair budget
 * is spent: the job reaches `completed`, the MP4 is real and the credits commit.
 * These tests pin the three ways a probe gets that wrong — calling it a clean
 * acceptance, calling it a failure, or looking for it in the wrong field.
 */
import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { deliveryOutcome, isDelivered, repairEvidence, reviewEvidence, summarizeProOutput } from "../scene3d-acceptance/lib/pro.mjs"
import { createReceipt, finalize, markAdvisory, validateReceipt } from "../scene3d-acceptance/lib/receipt.mjs"
import { advisoryClause } from "../scene3d-acceptance/lib/harness.mjs"

/** A delivered result the reviewer refused, shaped as the plugin publishes it. */
function advisoryOutput(overrides = {}) {
  return {
    videoUrl: "https://example.invalid/scene.mp4",
    scenePlan: { schemaVersion: 2, revisionId: "rev_1", width: 1920, height: 1080, fps: 24, durationInFrames: 240, shots: [] },
    sceneRevisionId: "rev_1",
    posterAssetId: "ast_poster",
    renderer: "remotion-three@1.0.0",
    validation: {
      status: "passed",
      reportAssetId: "ast_report",
      warnings: [{ code: "SCENE_REVIEW_REFUSED", message: "motion: the suitcase does not cross", shotId: "shot_1" }],
    },
    metadata: {
      width: 1920, height: 1080, fps: 24, frames: 240, duration: 10,
      review: {
        verdict: "refused",
        objections: [{ category: "motion", what: "The suitcase does not cross the frame.", correction: "Extend the span.", frames: [0, 4] }],
        observed: "A red suitcase beside a square pillar.",
      },
    },
    repairPasses: 2,
    admissionRetries: 1,
    mechanicalPasses: 1,
    ...overrides,
  }
}

/** The same delivery, with a review NOBODY could perform: the outage arm of the verdict. */
function unreviewedOutput(review = {}, warnings = null) {
  return advisoryOutput({
    validation: {
      status: "passed",
      reportAssetId: "ast_report",
      warnings: warnings ?? [
        { code: "SCENE_REVIEW_UNAVAILABLE", message: "… it was delivered unreviewed." },
      ],
    },
    metadata: {
      width: 1920, height: 1080, fps: 24, frames: 240, duration: 10,
      review: { verdict: "unavailable", reason: "provider", attempts: 2, objections: [], ...review },
    },
  })
}

describe("reviewEvidence", () => {
  it("reads the verdict, the objections and the warning count off a delivered scene", () => {
    const review = reviewEvidence(advisoryOutput())
    assert.equal(review.verdict, "refused")
    assert.equal(review.objectionCount, 1)
    assert.equal(review.refusedWarningCount, 1)
    assert.equal(review.observed, "A red suitcase beside a square pillar.")
    assert.deepEqual(review.objections[0], {
      category: "motion",
      what: "The suitcase does not cross the frame.",
      correction: "Extend the span.",
      frames: [0, 4],
    })
  })

  it("is null for a clean delivery, so absence means nothing to report", () => {
    const clean = advisoryOutput({ metadata: { width: 1920, height: 1080, fps: 24, frames: 240, duration: 10 }, validation: { status: "passed", warnings: [] } })
    assert.equal(reviewEvidence(clean), null)
  })

  /**
   * The two wrong discriminants, pinned. `validation.status` is `passed` on an
   * advisory delivery because the mandatory assertions DID pass, and a refusal
   * that named nothing actionable carries zero warnings.
   */
  it("does not key on validation.status, which is still passed", () => {
    assert.equal(reviewEvidence(advisoryOutput()).verdict, "refused")
    assert.equal(advisoryOutput().validation.status, "passed")
  })

  it("keeps a refusal that raised no objection and emitted no warning", () => {
    const silent = advisoryOutput({
      validation: { status: "passed", reportAssetId: "ast_report", warnings: [] },
      metadata: { width: 1920, height: 1080, fps: 24, frames: 240, duration: 10, review: { verdict: "refused", objections: [] } },
    })
    const review = reviewEvidence(silent)
    assert.equal(review.verdict, "refused")
    assert.equal(review.objectionCount, 0)
    assert.equal(review.refusedWarningCount, 0)
  })

  it("never invents a verdict from a warning, a status or a malformed review", () => {
    assert.equal(reviewEvidence({ validation: { warnings: [{ code: "SCENE_REVIEW_REFUSED", message: "x" }] } }), null)
    assert.equal(reviewEvidence({ metadata: { review: { verdict: "accepted", objections: [] } } }), null)
    assert.equal(reviewEvidence({ metadata: { review: "refused" } }), null)
    assert.equal(reviewEvidence(null), null)
    assert.equal(reviewEvidence("nope"), null)
  })

  it("drops an objection with no text rather than refusing the whole verdict", () => {
    const messy = advisoryOutput({
      metadata: { review: { verdict: "refused", objections: [{ category: "", what: "Flat lighting.", frames: [2, -1, "x"] }, { category: "motion" }, null] } },
    })
    const review = reviewEvidence(messy)
    assert.equal(review.objectionCount, 1)
    assert.deepEqual(review.objections[0], { category: "unsupported", what: "Flat lighting.", correction: null, frames: [2] })
  })
})

/**
 * The outage arm, and the reason a `verdict === "refused"` reader could not stay.
 *
 * A run delivered with NO verdict on it reads, through such a reader, as a clean
 * acceptance — the job completed, the video is real, `validation.status` is
 * `"passed"`. That is the same silence `reviewEvidence` exists to prevent, one
 * step further out: the reviewer's veto turned into silence in round 9c, and the
 * reviewer's ABSENCE turned into approval here.
 */
describe("reviewEvidence reads a review nobody could perform", () => {
  it("reports the verdict, why it is missing, and how many times the review was asked", () => {
    const review = reviewEvidence(unreviewedOutput())
    assert.equal(review.verdict, "unavailable")
    assert.equal(review.reason, "provider")
    assert.equal(review.attempts, 2)
    assert.equal(review.objectionCount, 0)
    assert.equal(review.unavailableWarningCount, 1)
    assert.match(review.reviewEvidenceSentence, /delivered UNREVIEWED/)
  })

  /** A review is BATCHED. What answered before the provider went away is real
   *  evidence, and reporting it as the verdict would be the opposite error. */
  it("keeps the batches that answered first, without calling them the verdict", () => {
    const review = reviewEvidence(unreviewedOutput({
      objections: [{ category: "motion", what: "The suitcase never crosses.", frames: [0] }],
    }, [
      { code: "SCENE_REVIEW_UNAVAILABLE", message: "… delivered unreviewed." },
      { code: "SCENE_REVIEW_REFUSED", message: "motion: the suitcase never crosses" },
    ]))
    assert.equal(review.verdict, "unavailable")
    assert.equal(review.objectionCount, 1)
    assert.equal(review.refusedWarningCount, 1)
    assert.equal(review.unavailableWarningCount, 1)
    assert.match(review.reviewEvidenceSentence, /not a verdict/)
  })

  it("clamps an attempt count that cannot describe asks that were made", () => {
    for (const attempts of [0, -1, 1.5, "two", undefined]) {
      assert.equal(reviewEvidence(unreviewedOutput({ attempts })).attempts, 1)
    }
  })

  /** The refused arm keeps exactly the fields it had: no `reason`, no `attempts`,
   *  so a ledger cannot read an outage into a refusal that answered. */
  it("adds nothing to a refusal that answered", () => {
    const refused = reviewEvidence(advisoryOutput())
    assert.equal(refused.verdict, "refused")
    assert.equal("attempts" in refused, false)
    assert.equal("reason" in refused, false)
    assert.equal("unavailableWarningCount" in refused, false)
  })

  it("still reports no verdict for one it has never heard of", () => {
    assert.equal(reviewEvidence(unreviewedOutput({ verdict: "shrugged" })), null)
  })
})

describe("deliveryOutcome", () => {
  it("names an advisory delivery apart from a clean one", () => {
    assert.equal(deliveryOutcome({ terminalStatus: "completed", output: advisoryOutput() }), "completed-advisory")
    assert.equal(deliveryOutcome({ terminalStatus: "completed", output: { videoUrl: "x", metadata: {} } }), "completed")
  })

  it("passes every non-completed ending through unchanged", () => {
    for (const status of ["failed", "cancelled", null]) {
      assert.equal(deliveryOutcome({ terminalStatus: status, output: advisoryOutput() }), status)
    }
  })

  it("treats both deliveries as delivered, and nothing else", () => {
    assert.equal(isDelivered("completed"), true)
    assert.equal(isDelivered("completed-advisory"), true)
    for (const status of ["failed", "cancelled", null, undefined]) assert.equal(isDelivered(status), false)
  })
})

describe("repairEvidence records admission retries beside repair passes", () => {
  it("reads both counts without folding one into the other", () => {
    const evidence = repairEvidence({ output: advisoryOutput(), quote: null, requested: 2 })
    assert.deepEqual(evidence.reportedByOutput, { key: "repairPasses", value: 2 })
    assert.equal(evidence.admissionRetries, 1)
    assert.match(evidence.admissionEvidence, /counted apart/)
  })

  it("reads the mechanical passes APART from the repair count when the quote priced them", () => {
    const quote = { breakdown: [
      { code: "repair", label: "Repair passes (up to 2)", credits: 120 },
      { code: "mechanical", label: "Mechanical passes (up to 2, no planner)", credits: 60 },
    ] }
    const evidence = repairEvidence({ output: advisoryOutput(), quote, requested: 2 })
    assert.equal(evidence.mechanicalPasses, 1)
    assert.deepEqual(evidence.quotedMechanicalLines.map((l) => l.code), ["mechanical"])
    assert.match(evidence.mechanicalEvidence, /APART from the repair passes/)
  })

  it("says the OLDER accounting applies when the quote carried no mechanical line", () => {
    // The discriminant is the quote, not the result: the same output means a subset of
    // repairPasses on a run quoted before the allowance existed. Reporting one rule for
    // both would misstate what half the runs actually spent.
    const legacy = { breakdown: [{ code: "repair", label: "Repair passes (up to 2)", credits: 120 }] }
    const evidence = repairEvidence({ output: advisoryOutput(), quote: legacy, requested: 2 })
    assert.deepEqual(evidence.quotedMechanicalLines, [])
    assert.match(evidence.mechanicalEvidence, /subset of it/)
  })

  it("selects the repair allowance by CODE, so a sibling label saying 'repair' is not swept in", () => {
    // The old filter tested /repair/i over `${code} ${label}`. A line labelled
    // "Mechanical repairs ..." would have been counted as part of the repair allowance.
    const quote = { breakdown: [
      { code: "repair", label: "Repair passes (up to 2)", credits: 120 },
      { code: "mechanical", label: "Mechanical repairs (up to 2, no planner)", credits: 60 },
    ] }
    const evidence = repairEvidence({ output: advisoryOutput(), quote, requested: 2 })
    assert.deepEqual(evidence.quotedRepairLines.map((l) => l.code), ["repair"])
    assert.deepEqual(evidence.quotedMechanicalLines.map((l) => l.code), ["mechanical"])
  })

  it("keeps the admission quote line apart from the repair lines", () => {
    const quote = { breakdown: [
      { code: "repair", label: "Repair passes (up to 2)", credits: 120 },
      { code: "admission", label: "Admission retries (up to 3, planner only)", credits: 99 },
      { code: "render", label: "Render", credits: 40 },
    ] }
    const evidence = repairEvidence({ output: advisoryOutput(), quote, requested: 2 })
    // The admission line says "planner only" and never "repair", so the repair
    // filter must not sweep it up — they are ceilings on different purchases.
    assert.deepEqual(evidence.quotedRepairLines.map((l) => l.code), ["repair"])
    assert.deepEqual(evidence.quotedAdmissionLines.map((l) => l.code), ["admission"])
  })

  it("reports no admission quote line when the deployment does not price one", () => {
    const evidence = repairEvidence({ output: advisoryOutput(), quote: { breakdown: [{ code: "repair", label: "Repair passes", credits: 120 }] }, requested: 2 })
    assert.deepEqual(evidence.quotedAdmissionLines, [])
  })

  it("reports zero admission retries as zero, and a missing count as null", () => {
    assert.equal(repairEvidence({ output: advisoryOutput({ admissionRetries: 0 }), quote: null, requested: 2 }).admissionRetries, 0)
    const absent = repairEvidence({ output: { repairPasses: 1 }, quote: null, requested: 2 })
    assert.equal(absent.admissionRetries, null)
    assert.match(absent.admissionEvidence, /absent is not zero/)
  })

  it("reports zero mechanical passes as zero, and a missing count as null", () => {
    // Absent is what every engine older than the mechanical pass reports, so it must
    // not read as "the planner authored every repair" — that is a different claim.
    assert.equal(repairEvidence({ output: advisoryOutput({ mechanicalPasses: 0 }), quote: null, requested: 2 }).mechanicalPasses, 0)
    const absent = repairEvidence({ output: { repairPasses: 1 }, quote: null, requested: 2 })
    assert.equal(absent.mechanicalPasses, null)
    assert.match(absent.mechanicalEvidence, /absent is not zero/)
  })

  it("does not tie the mechanical count to the repair count", () => {
    // Under its own allowance a run can spend more mechanical passes than repairs.
    // Any assertion of `mechanical <= repair` would reject a legitimate run.
    const quote = { breakdown: [{ code: "mechanical", label: "Mechanical passes (up to 2, no planner)", credits: 60 }] }
    const evidence = repairEvidence({ output: advisoryOutput({ repairPasses: 1, mechanicalPasses: 2 }), quote, requested: 2 })
    assert.equal(evidence.reportedByOutput.value, 1)
    assert.equal(evidence.mechanicalPasses, 2)
  })
})

describe("summarizeProOutput", () => {
  it("carries the review into the receipt's output summary", () => {
    assert.equal(summarizeProOutput(advisoryOutput()).review.objectionCount, 1)
    assert.equal(summarizeProOutput({ videoUrl: "x" }).review, null)
  })
})

describe("the receipt says advisory without changing the verdict", () => {
  const make = () => createReceipt({ subcommand: "authoring", runId: "r1", baseUrl: "https://next.example.invalid" })

  it("starts false on every receipt, so absence means an older harness wrote it", () => {
    assert.equal(make().advisory, false)
  })

  it("records the verdict and still finalizes as passed", () => {
    const receipt = make()
    receipt.assertions.push({ name: "delivered", expected: "completed | completed-advisory", actual: "completed-advisory", pass: true })
    markAdvisory(receipt, reviewEvidence(advisoryOutput()))
    finalize(receipt)
    assert.equal(receipt.advisory, true)
    assert.equal(receipt.measurements.review.verdict, "refused")
    assert.equal(receipt.measurements.review.objections[0].what, "The suitcase does not cross the frame.")
    // The verdict and the exit code are untouched: an advisory delivery is a real result.
    assert.equal(receipt.status, "passed")
    assert.equal(receipt.pass, true)
    assert.deepEqual(validateReceipt(receipt), [])
  })

  it("keeps a multi-step probe's refusals apart by role", () => {
    const receipt = make()
    markAdvisory(receipt, { verdict: "refused", objectionCount: 2, objections: [] }, "generate")
    markAdvisory(receipt, { verdict: "refused", objectionCount: 1, objections: [] }, "edit")
    assert.deepEqual(Object.keys(receipt.measurements.reviews), ["generate", "edit"])
    assert.equal(receipt.measurements.reviews.generate.objectionCount, 2)
    assert.equal(receipt.measurements.review.objectionCount, 1)
  })

  it("refuses a non-boolean advisory flag", () => {
    const receipt = finalize(Object.assign(make(), { assertions: [{ name: "a", expected: 1, actual: 1, pass: true }] }))
    receipt.advisory = "yes"
    assert.ok(validateReceipt(receipt).includes("advisory is not a boolean"))
  })
})

/**
 * The outcome and the operator line, for the delivery nobody reviewed.
 *
 * No THIRD outcome is added on purpose: to a ledger an unreviewed delivery is
 * the same kind of thing as an advisory one — paid, playable, not clean — and a
 * new string would break every caller that switches on this one. What must not
 * be the same is the SENTENCE: "advisory review: 0 objections" for a scene
 * nobody looked at says the reviewer found nothing, which is the reading an
 * operator acts on wrongly.
 */
describe("an unreviewed delivery is completed-advisory, and says so in words", () => {
  it("maps to completed-advisory, exactly as a refusal does", () => {
    assert.equal(deliveryOutcome({ terminalStatus: "completed", output: unreviewedOutput() }), "completed-advisory")
    assert.equal(isDelivered(deliveryOutcome({ terminalStatus: "completed", output: unreviewedOutput() })), true)
  })

  it("never reports it as an advisory review that found nothing", () => {
    const receipt = markAdvisory(createReceipt({ subcommand: "authoring", runId: "r1", baseUrl: "https://next.example.invalid" }),
      reviewEvidence(unreviewedOutput()), "authoring")
    const line = advisoryClause(receipt)
    assert.match(line, /review UNAVAILABLE after 2 attempts/)
    assert.doesNotMatch(line, /advisory review: 0 objections/)
  })

  it("says both when a multi-step probe delivered both ways", () => {
    const receipt = createReceipt({ subcommand: "blender-cloud-v2", runId: "r1", baseUrl: "https://next.example.invalid" })
    markAdvisory(receipt, reviewEvidence(advisoryOutput()), "generate")
    markAdvisory(receipt, reviewEvidence(unreviewedOutput()), "render")
    const line = advisoryClause(receipt)
    assert.match(line, /advisory review: 1 objection/)
    assert.match(line, /1 step UNREVIEWED after 2 attempts/)
  })

  it("counts partial batches as partial in the line", () => {
    const receipt = markAdvisory(createReceipt({ subcommand: "authoring", runId: "r1", baseUrl: "https://next.example.invalid" }),
      reviewEvidence(unreviewedOutput({
        objections: [{ category: "motion", what: "The suitcase never crosses.", frames: [0] }],
      })), "authoring")
    assert.match(advisoryClause(receipt), /review UNAVAILABLE after 2 attempts, 1 objection from partial batches/)
  })
})
