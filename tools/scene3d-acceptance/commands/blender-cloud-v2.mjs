/**
 * Probe 4 — THE BASIC LANE ON `blender-cloud`.
 *
 * Exactly what MCP's `generate_3d_scene` maps onto: the Basic authoring node
 * with `engine: "blender-cloud"` and `acceptedSceneSchemaVersions: [2]`, then
 * an edit on the same engine, then a render of the resulting revision through
 * the ordinary render-video node.
 *
 * This is the probe that proves an agent can reach the advanced engine without
 * `pro-3d-render` — one editable retained v2 revision, no MP4 export implied —
 * and that the revision it gets back is a real one the render node accepts.
 * The three steps are separate jobs on purpose: a fused helper would hide
 * which of them a deployment cannot serve.
 */
import { parseReference, toInt, toNumber } from "../lib/args.mjs"
import { HarnessError, idempotencyKeyFor, makeClient, readBalance, readCapabilities, requireAdvancedEngine, stampPrompt, submitOnce } from "../lib/client.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { shortHash } from "../lib/parity.mjs"
import { followJob, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { deliveryOutcome, isDelivered, reviewDetail, reviewEvidence, summarizePlan } from "../lib/pro.mjs"

export const NAME = "blender-cloud-v2"
export const ENGINE = "blender-cloud"

/** Mine, not a fixture: a small instruction any table-ish scene can satisfy. */
const DEFAULT_EDIT_PROMPT = "Pull the camera back slightly so a little more of the scene is in frame."

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const brief = await resolvePrompt({ prompt: values.prompt, promptFile: values["prompt-file"], what: "a short brief" })
  const references = (values.ref ?? []).map((spec, index) => parseReference(spec, index, { defaultRole: "appearance", kind: "image" }))
  const durationSeconds = toNumber(values.duration, "duration", { min: 1, max: 600 })
  const fps = toInt(values.fps, "fps", { min: 1, max: 60 })
  const aspectRatio = values.aspect
  const maxRepairPasses = toInt(values["repair-passes"], "repair-passes", { min: 0, max: 2 })
  const editPrompt = values["edit-prompt"] ?? DEFAULT_EDIT_PROMPT
  const stampedPrompt = stampPrompt(brief.text, ctx.runId)

  const generateParams = {
    prompt: stampedPrompt,
    engine: ENGINE,
    acceptedSceneSchemaVersions: [2],
    durationSeconds,
    fps,
    aspectRatio,
    maxRepairPasses,
    ...(references.length > 0 ? { references } : {}),
  }
  receipt.inputs = {
    ...receipt.inputs,
    engine: ENGINE,
    promptSource: brief.source,
    promptSha: shortHash(stampedPrompt),
    promptChars: stampedPrompt.length,
    editPrompt,
    references: references.map((r) => ({ id: r.id, kind: r.kind, role: r.role, urlHost: hostOf(r.url), urlSha: shortHash(r.url) })),
    durationSeconds, fps, aspectRatio, maxRepairPasses,
    generateRequest: generateParams,
  }
  ctx.save()
  if (ctx.dryRun) return

  const { client } = await makeClient({ baseUrl: args.baseUrl })
  const caps = await readCapabilities(client)
  receipt.inputs.capabilities = caps.raw
  requireAdvancedEngine(caps, ENGINE, { schemaVersion: 2 })
  receipt.credits.balanceBefore = await readBalance(client)
  ctx.save()

  // ---- generate ----------------------------------------------------------
  const generated = await runNodeStep(ctx, client, {
    role: "generate",
    type: "generate-3d-scene",
    params: generateParams,
  })
  if (!assertDelivered(ctx, "generate-3d-scene delivered a scene on blender-cloud", generated)) return
  const generatedPlan = generated.output?.scenePlan ?? null
  receipt.outputs.generate = { plan: summarizePlan(generatedPlan), changeSummary: generated.output?.changeSummary ?? null }
  ctx.save()
  ctx.assert("the generated scene is schema version 2", { expected: 2, actual: generatedPlan?.schemaVersion ?? null })
  ctx.assert("the generated scene carries a retained revision id", {
    expected: "a revision id",
    actual: generatedPlan?.revisionId ?? null,
    pass: typeof generatedPlan?.revisionId === "string" && generatedPlan.revisionId.length > 0,
  })
  ctx.assert("the generated scene was built by the advanced engine", {
    expected: "a provenance engine",
    actual: generatedPlan?.provenance?.engine ?? null,
    pass: typeof generatedPlan?.provenance?.engine === "string" && generatedPlan.provenance.engine.length > 0,
    detail: `compiler ${generatedPlan?.provenance?.compilerVersion ?? "?"}, exporter ${generatedPlan?.provenance?.exporterVersion ?? "?"}`,
  })
  if (!generatedPlan) return

  // ---- edit --------------------------------------------------------------
  const editParams = {
    scenePlan: generatedPlan,
    expectedRevisionId: generatedPlan.revisionId,
    prompt: editPrompt,
    engine: ENGINE,
    acceptedSceneSchemaVersions: [2],
  }
  receipt.inputs.editRequest = { ...editParams, scenePlan: `<the generated revision ${generatedPlan.revisionId}>` }
  const edited = await runNodeStep(ctx, client, { role: "edit", type: "edit-3d-scene", params: editParams })
  const editedPlan = edited.output?.scenePlan ?? null
  receipt.outputs.edit = { plan: summarizePlan(editedPlan), changeSummary: edited.output?.changeSummary ?? null }
  ctx.save()
  assertDelivered(ctx, "edit-3d-scene delivered a scene on blender-cloud", edited)
  ctx.assert("the edit produced a new revision", {
    expected: `something other than ${generatedPlan.revisionId}`,
    actual: editedPlan?.revisionId ?? null,
    pass: Boolean(editedPlan?.revisionId) && editedPlan.revisionId !== generatedPlan.revisionId,
  })
  ctx.assert("the edited scene is still schema version 2", { expected: 2, actual: editedPlan?.schemaVersion ?? null })
  ctx.assert("the edited revision names its parent", {
    expected: generatedPlan.revisionId,
    actual: editedPlan?.parentRevisionId ?? null,
  })

  // ---- render ------------------------------------------------------------
  const planToRender = editedPlan ?? generatedPlan
  if (values["skip-render"] === true) {
    ctx.note("render skipped by --skip-render")
  } else {
    const renderParams = { planType: "3d-scene", plan: planToRender }
    receipt.inputs.renderRequest = { planType: "3d-scene", plan: `<revision ${planToRender.revisionId}>` }
    const rendered = await runNodeStep(ctx, client, { role: "render", type: "render-video", params: renderParams })
    receipt.outputs.render = {
      videoUrl: typeof rendered.output?.videoUrl === "string" ? rendered.output.videoUrl : null,
      videoHost: typeof rendered.output?.videoUrl === "string" ? hostOf(rendered.output.videoUrl) : null,
      thumbnailUrl: rendered.output?.thumbnailUrl ?? null,
    }
    ctx.save()
    assertDelivered(ctx, "render-video delivered the edited revision", rendered)
    ctx.assert("the render published a video", {
      expected: "a video url",
      actual: receipt.outputs.render.videoHost,
      pass: Boolean(receipt.outputs.render.videoUrl),
    })
  }

  receipt.credits.balanceAfter = await readBalance(client)
  receipt.credits.committed = receipt.jobs.reduce((total, entry) => total + (typeof entry.credits === "number" && entry.creditStatus === "committed" ? entry.credits : 0), 0)
  ctx.save()
}

/** Submit one node run, follow it, and record everything it produced. */
async function runNodeStep(ctx, client, { role, type, params }) {
  const { args, receipt } = ctx
  const key = idempotencyKeyFor(ctx.runId, role)
  const { jobId } = await submitOnce(client, { type, params, idempotencyKey: key })
  ctx.recordJob({ jobId, role, nodeType: type, idempotencyKey: key })
  ctx.log(`${role} job ${jobId}`)
  const follow = await followJob(client, jobId, {
    pollMs: args.pollMs,
    timeoutMs: args.timeoutMs,
    onTransition: (t) => ctx.log(`  ${role} ${t.status}${t.phase ? `/${t.phase}` : ""}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
  })
  const job = await readJobRecord(client, jobId)
  receipt.timings[role] = phaseTimings(job, follow)
  ctx.recordJob({ jobId, role, terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, errorMessage: job?.error_message ?? null, errorHint: job?.error_hint ?? null })
  const output = follow.output ?? job?.output_data ?? null
  // ONE place reads the reviewer's verdict for all three steps. Every step here can
  // author, so every step can end `completed-advisory` — the scene was delivered
  // over the reviewer's objection once the repair budget was spent — and a per-step
  // copy of this rule is how the three would drift apart.
  const review = reviewEvidence(output)
  if (review) ctx.advisory(review, role)
  ctx.save()
  return {
    jobId,
    terminalStatus: follow.terminalStatus,
    outcome: deliveryOutcome({ terminalStatus: follow.terminalStatus, output }),
    review,
    output,
    errorMessage: job?.error_message ?? null,
  }
}

/** The assertion every step makes about its own ending, in the vocabulary above. */
function assertDelivered(ctx, name, step) {
  return ctx.assert(name, {
    expected: "completed | completed-advisory",
    actual: step.outcome,
    pass: isDelivered(step.outcome),
    detail: reviewDetail(step.review) ?? step.errorMessage ?? undefined,
  })
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export { HarnessError }
