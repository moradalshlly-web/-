# 3D Render Pro

Author an animated 3D scene from a prompt **and export it**, in one durable
operation. A single job settles with both halves of the result: the exact
composition and the rendered MP4.

This is a different node from [Generate 3D Scene](generate-3d-scene.md), not a
setting on it. Generate 3D Scene is a cheap, editable clay previz pass whose
MP4 comes from a separate [Render Video](render-video.md) run; 3D Render Pro
produces a finished shot in one go, on a hosted build engine.

## Availability

3D Render Pro exists only on deployments whose installed authoring engine
implements it. Check before you offer it:

```typescript
const caps = await client.scene3d.capabilities();
if (caps.pro?.available) {
  // the node is servable here
}
```

`GET /v1/nodes` omits the type entirely where it is unavailable, and the editor
does not show it in the Add Node picker. A request sent anyway is refused with
`503 SCENE_CAPABILITY_UNAVAILABLE` — it never falls back to the Basic lane.

Workflows that already contain the node keep rendering their stored
composition and their stored video if the engine is later switched off. Only
new runs are refused.

## The source

Every run names exactly one **source**, and the choice is what decides both
the pipeline and the price.

| Source | Shape | What happens |
|---|---|---|
| New scene | `{ kind: "prompt", prompt, references?, inputAssets? }` | Authors a scene from your brief, then renders it. |
| Existing scene | `{ kind: "scene", revisionId, sourceJobId }` | **Render-only.** Exports that exact revision. No authoring or build charge. |
| Existing scene, revised | `{ kind: "scene", revisionId, sourceJobId, editPrompt }` | Revises the scene first, then renders it. |
| Desktop export | `{ kind: "local-export", exportId, connectionId }` | Uses a completed export from a paired desktop Blender, where that is available. |

`editPrompt` is what separates a render-only export from a paid revision, so
**omit the field** when you want a plain export. Sending an empty string is a
different request and is treated as one.

`sourceJobId` is required for Basic scenes retained only in job history. It is
optional for retained revisions, including manual edits. The platform checks
current scene permissions for retained revisions and job ownership for Basic
job-history sources; knowing either identifier does not grant access.

`inputAssets` selects existing GLBs by `{id, revisionId, assetId, label?}`;
it is separate from image/video `references` and uses the same limits as
[Generate 3D Scene](generate-3d-scene.md). It requires engine import support.
The quote and run must carry identical selectors. The server rechecks current
permissions and immutable byte receipts before admitting the quoted run.
Existing-scene and desktop-export sources do not accept new input selectors.

On the canvas, pick the source in the node's panel and wire the scene into the
node's **Scene** input.

## Inputs

| Input | Purpose |
|---|---|
| Scene | An existing composition from another 3D node (canvas `scene` handle). |
| References | Up to 8 total, including at most 1 video. Images guide appearance/layout; video guides motion/layout. New-scene source only. |
| Duration | 1–60 seconds; default 10. |
| FPS | 15–60; default 24. |
| Aspect ratio | `16:9` (default), `9:16`, `1:1`, `4:5` or `21:9`. |
| Style | `clay` (default). |
| Quality | The profiles this deployment advertises; `standard` today. |
| Correction budget | 0–2 repair passes after the first attempt; default 2. Each pass is paid work, which is why it is shown. |
| Engine | `blender-cloud` (default) or `blender-local` where a paired desktop is available. An unknown or unavailable engine is rejected rather than downgraded. |

There is **no model or reasoning-effort field**. The planner is fixed and
server-owned, so there is nothing here to pick.

**Timing on an existing scene.** A scene already has its own duration, fps and
aspect ratio. Omit those fields to keep them; sending them is an explicit
re-time request, and an incompatible one is rejected rather than silently
applied.

## Outputs

| Handle | Value |
|---|---|
| `composition` | The scene revision this run produced — the same kind of plan the Basic 3D nodes emit. Connect it to [Render Video](render-video.md), or to another 3D node's Scene input, to re-export without paying to author again. |
| `stills` | One still image per shot of the composition, in shot order — each is the frame that shot opens on. Connect it to any node that consumes images; the whole set travels down the wire, not just the first. |
| `video` | The exported MP4, the platform's standard video result. Connect it to any node that consumes a video. |

Wire a downstream video consumer from **`video`**, not from `composition`: the
composition handle carries a plan, not a URL.

**The stills are a contact sheet, not a second render.** They come out of the
same run at no extra credit cost, and a v1 (single-shot) scene produces exactly
one, at frame 0. Use them to feed a shot's opening frame into an image or video
model as a reference, or to review the blocking shot by shot without scrubbing
the MP4. A result produced before this existed simply has none.

**Wiring a still into any image input just works.** Their bytes stay in the
private scene bucket, so the `url` you read back is authenticated rather than a
public link — but you do not have to solve that to use one. Connect the `stills`
handle to a node's image or reference-image input and, for that run only, the
platform grants the model a short-lived, single-artifact read of the exact still
it needs; the grant expires minutes later and is never stored. The stored
result keeps the authenticated URL, which is the one still meaningful tomorrow.

The grant is issued against **your own** access, at the moment the run is
dispatched: a still from a delivery you can no longer read is not sent, and no
link that outlives the run is created anywhere.

The completed job's `output_data` carries the fields below. A job that failed
with `SCENE_QUALITY_FAILED` carries a smaller set of the same fields, pointing
at the draft it kept — see [Errors](#errors). A completed job may also have been
delivered **without the visual reviewer's approval** — the scene passed every
mandatory check, and the reviewer either objected or gave no usable verdict at all —
which adds `metadata.review`; see
[When a scene that passed is delivered unapproved](#when-a-scene-that-passed-is-delivered-unapproved).

| Field | Meaning |
|---|---|
| `videoUrl` | The exported MP4 — the platform's standard video result field. |
| `scenePlan` | The exact composition it was rendered from. |
| `sceneRevisionId` | That revision's id, for a later render-only re-run. |
| `posterAssetId` | Preview poster for the result. |
| `shotStills` | One entry per shot, ordered by `shotIndex`: `{ shotIndex, frame, assetId, url }`. `shotIndex` is 0-based in the composition's shot order and `frame` is the shot's own first frame in the composition's frame space, so a still lines up against the MP4 without re-deriving shot boundaries. Each `url` is an authenticated delivery endpoint, not a public link — the editor reads it with your session, and a run that wires a still into a model is granted its own short-lived read (see Outputs above). Absent on a result that rendered none. |
| `sourceArtifactId` | Present when an editable native source was retained. |
| `validation` | `{ status, reportAssetId, warnings[] }` — each warning has a `code`, a `message` and an optional `shotId`. `status` is `passed` here; a **failed** job can carry this field too, with `status: "failed"` (see [Errors](#errors)). See [Warning codes](#warning-codes) for what a `code` can be. |
| `renderer` | Renderer identity/version the export was produced with. |
| `metadata` | `{ width, height, fps, frames, duration }` — check these against a downstream model's video-reference limits before wiring the MP4 in. On a run that authored, it also carries `summary`: the planner's own one-or-two-sentence description of what it made, and on a repaired run, of the repair. Optional — a run that returned no summary is not an error. On a delivery the reviewer did not approve it additionally carries `review` (below). |
| `metadata.review` | Present **only** on a delivery the visual reviewer did not approve. Read `verdict` — it is the discriminant, and it has two values. `{ verdict: "refused", objections[], observed? }` is the scene the reviewer objected to and that was delivered anyway. `{ verdict: "unavailable", reason, attempts, objections[], observed? }` is the scene **nobody reviewed**: the review produced no usable verdict in `attempts` asks, so no verdict on it exists. `reason` says why — `"provider"` when the review never reached its provider, `"unusable"` when the provider answered with nothing usable. Each objection is `{ category, what, correction?, frames[] }` — `what` is the finding itself, `correction` the recipe-level change it asked for where it named one, and `frames` the frames it cited. There is no `severity`: only blocking findings become objections. `objections` may be **empty**, which reports a refusal that named nothing actionable; on the `unavailable` arm it holds whichever review batches answered usably first, which are **not** the verdict. Absent on every other result, including a clean one. |
| `repairPasses` | How many repair passes actually RAN, never the number of authoring passes — so a composition accepted first time reports `0`, not `1`. Optional, and **absent** rather than `0` on a render-only export, which authored nothing and had no repair budget to spend. |
| `admissionRetries` | Pre-build planner retries: a recipe the compiler would not admit is re-asked of the planner, with no build and no repair pass spent. Counted apart from `repairPasses` and never folded into it — they buy different things. Optional, and absent on a run that needed none. |
| `mechanicalPasses` | Repairs the engine applied **itself**, from the compiler's own structured remedy, with no planner call. Counted **apart** from `repairPasses` and never folded into it: these passes spend their own quoted allowance — the `mechanical` line, up to 2, released when unspent — rather than one of your repairs, so a run may report more mechanical passes than repairs. The pass identity the pricing keeps is `buildPasses = authoringPasses + repairPasses + mechanicalPasses`. Each one also adds a `REMEDY_AUTO_APPLIED` warning. Optional, and absent both when the run took none and on an engine that does not report it. See [The mechanical-pass allowance](#the-mechanical-pass-allowance). |
| `restoredAssertions` | Mandatory assertions the engine put **back** after a planner answer re-shaped one the feedback had not named — restored to the last admitted recipe's exact form so the run continues instead of refusing over a value the engine already held. Each entry is `{op, path, value?, assertionId, reason}` and also an `ASSERTION_RESTORED` warning. Optional; absent on a run that restored nothing. |

#### Warning codes

Every entry in `validation.warnings[]` carries a `code`, and the code is what tells
the two kinds of advisory apart. Treat an unknown code as informational rather
than an error — the list is open-ended by design.

| Code | Means |
|---|---|
| `SCENE_AUTHORING_ASSUMPTION` | The brief did not say, so the run decided. One entry per assumption the planner made, with any normalization the engine applied to it. These appear on a run that **authored**; a render-only export has none. |
| `SCENE_REVIEW_REFUSED` | One objection the visual reviewer raised against a scene this job **delivered anyway**. One entry per objection, carrying a `shotId` when every frame it cites falls inside one shot. The whole verdict, including any objection the row could not fit, is in `metadata.review`. |
| `SCENE_REVIEW_UNAVAILABLE` | **Nobody reviewed this scene.** The visual review produced no usable verdict — it never reached its provider, or the provider answered with nothing usable — so the assertion-passing scene was delivered — or, where the deployment does not deliver unapproved scenes, retained as a draft — with no verdict on it. One entry, and it **leads** the array: it qualifies every line under it, because any `SCENE_REVIEW_REFUSED` entry below came from a review that never finished. The message says which of the two it was, and how many times the review was asked. |
| `REMEDY_AUTO_APPLIED` | One remedy the engine applied **itself** on a mechanical repair pass, rather than asking the planner for a fix. Names the mandatory assertion that refused the build, the change that was applied, and the measurement before it. One entry per remedy; the count of such passes is `mechanicalPasses`. |
| `ASSERTION_RESTORED` | One mandatory assertion the engine put **back** after a planner answer re-shaped it without being asked to. A repair may change what the feedback names; an assertion outside that invitation is restored to its last admitted form and the run continues. Names the assertion, the edit that restored it and why. Counted by `restoredAssertions`. |
| `SCENE_QUALITY_BLOCKING` | The paid visual reviewer found a blocking problem with the built scene. Carries a `shotId` when the cited frames all fall inside one shot. |
| `SCENE_QUALITY_EVIDENCE_INSUFFICIENT` | The reviewer could not establish the requested behaviour from the frames it was given. |
| `SCENE_STAGE_AMBIGUOUS` | A paid stage call — the planner's, for example — whose worker stopped mid-call (a deploy or restart), so its outcome is unknown. The run does not repeat a call it may already have paid for; it ends instead, and this entry names the call. It appears among the refusals on a **failed** job that retained its draft. |

The reviewer's findings reach you under **two** different codes, and which one
you get says what happened to the scene:

- `SCENE_QUALITY_BLOCKING` / `SCENE_QUALITY_EVIDENCE_INSUFFICIENT` appear on a
  job that **failed** with `SCENE_QUALITY_FAILED`. The finding is the reason
  there is no video.
- `SCENE_REVIEW_REFUSED` appears on a job that **completed**. The video is real
  and the finding is advice about it. A review that could not establish the
  requested behaviour arrives here as an objection with `category: "evidence"`
  rather than under its own code.
- `SCENE_REVIEW_UNAVAILABLE` says there is no finding at all, because there is
  no reviewer verdict. It appears on a **completed** job beside `metadata.review`
  — and, where the deployment retains unapproved scenes instead of delivering
  them, on a **failed** one, which publishes no `metadata` block and where this
  warning is the only thing that says the draft was never judged.

The complete finding set is always in the pinned validation report, not the row.

## Using the result as a video reference

The exported MP4 is a **layout reference**: it carries where the subjects
are, what is in front of what, the framing, the camera move and the timing.
It also carries a look — untextured grey clay — and a video model copies that
look unless it is told not to. Two rules, both measured on a real scene, keep
the layout and drop the clay:

**1. Never attach the clay render without a scoping line.** One sentence per
reference, naming what it is *for* and what to *ignore*. Wire the `video`
output into a video node's **Video references** input and the platform adds the
line for that reference itself — on a workflow run, on the video node's own Run
button, and in the node's **Final** prompt preview, which shows the line exactly
as it is sent. Through the API, pass it as the reference's caption — `referenceVideoCaptions[N]` for the clip on
`referenceVideoUrls[N]`. The line the platform sends for a clip is:

> LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing, its camera angle, its camera motion and its timing. Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. Take the look from the prompt and from the other references

The model reads it as `@video_1: <that line>.` — the same seat every video
caption renders to. A composition with several shots adds their cut points to
the "match" clause; a frame extracted from the render and wired as an image
reference gets the same line without the motion and timing clauses. A prompt
that already carries a scoping line for that reference is left alone, so
re-running never doubles it.

**2. Every figure that must look real needs its own character reference.**
Photoreal treatment is granted per referenced subject, not globally: with one
layout reference and one Character, only that character converts and every
other figure reverts to a clay proxy. With one Character per figure, every
figure converts and every identity holds. Keep two reference slots free for a
location or style plate. A workflow run whose composition has more `person`
entities than character references still runs — you may want clay figures —
and records a `scene3d_unreferenced_figures` warning on the job
(`input_data.warnings`, `{ code, message }`) saying how many figures are
uncovered and whether one-per-figure fits the model's reference budget.

Wire the render into the **reference** input, never the start-frame slot: a
start frame is a look anchor that no scoping line reaches.

## Quote, then run

Two endpoints, one paid job.

`POST /v1/pro-3d-render/quote` takes the request **without** a `quoteId` and
answers a ceiling you can show before anyone commits:

```json
{
  "quoteId": "...",
  "expiresAt": "2026-09-08T01:00:00.000Z",
  "maxCredits": 900,
  "breakdown": [{ "code": "authoring", "label": "Authoring", "credits": 600 }],
  "pricingVersion": "...",
  "capabilitiesVersion": "...",
  "normalizedInputHash": "..."
}
```

Quoting reserves nothing and spends nothing. `maxCredits` is a **ceiling**, not
a charge.

`POST /v1/pro-3d-render` then takes the same body plus that `quoteId` and an
`Idempotency-Key` header (8–255 characters), and returns `{ jobId }`. Admission
re-checks the quote against the request, so a body edited between the two calls
is refused rather than run at a price it was never quoted for. An expired or
stale quote is refused before anything is reserved — request a new one.

Reuse the same `Idempotency-Key` when retrying a submit that timed out, so one
intent cannot become two paid runs.

## API and SDK

```typescript
const caps = await client.scene3d.capabilities();
if (!caps.pro?.available) return; // this deployment cannot serve it

// Author a new scene and export it — quotes and runs in one call.
const shot = await client.scene3d.renderProAndWait({
  source: {
    kind: "prompt",
    prompt: "A red suitcase rolls behind a central pillar and reappears. Dolly right over thirty seconds.",
    references: [{ id: "look", kind: "image", role: "appearance", url: appearanceImageUrl }],
  },
  durationSeconds: 30,
  fps: 24,
  aspectRatio: "21:9",
  maxRepairPasses: 2,
});

shot.videoUrl;         // the exported MP4
shot.scenePlan;        // the exact composition it was rendered from
shot.sceneRevisionId;  // that revision's id

// Later: export the SAME revision again. Render-only — no authoring charge.
await client.scene3d.renderProAndWait({
  source: { kind: "scene", revisionId: shot.sceneRevisionId, sourceJobId: shotJobId },
});
```

Show the ceiling first by quoting explicitly:

```typescript
const quote = await client.scene3d.quotePro(params);
// ...show quote.maxCredits and quote.breakdown...
await client.scene3d.runPro({ ...params, quoteId: quote.quoteId });
```

`client.nodes.run("pro-3d-render", params)` and
`client.nodes.runAndWait("pro-3d-render", params)` reach the same routes with
the same types; both require the `quoteId`.

References use `{ id, url, kind, role }` exactly as the Basic authoring nodes
do; `kind` is `image` or `video`, `role` is `appearance`, `layout` or `motion`.
The whole reference clip is analyzed — trim a segment first with `trim-video`
if you need part of one.

Pass `acceptedSceneSchemaVersions` to declare which scene-schema versions your
client can render. 3D Render Pro produces version 2; a client that does not
accept it is refused before the build rather than handed a manifest it cannot
open.

### Errors

| Status / code | Meaning |
|---|---|
| `503 SCENE_CAPABILITY_UNAVAILABLE` | This deployment has no engine that implements the operation, or the requested engine / local execution is unavailable here. |
| `503 price_not_configured` | The operator has not configured a credit price for `pro-3d-render`. Nothing was reserved. |
| `400 validation_error` | Body, source shape, engine value, correction budget, reference list, accepted-schema mismatch, missing `quoteId`, or a missing/out-of-bounds `Idempotency-Key`. |

Runtime failures use the scene error codes (`SCENE_RESOURCE_LIMIT`,
`SCENE_EXPORT_UNSUPPORTED`, `SCENE_QUALITY_FAILED`, `SCENE_REVISION_CONFLICT`,
`SCENE_BUILD_TIMEOUT`, `SCENE_RENDER_FAILED`, and the local-executor codes) on
the job, not the submission. The job's error message starts with the code.

The planning stage adds three codes of its own. Two are worth retrying as-is;
the third is not:

| Code | Retry? | Meaning |
|---|---|---|
| `SCENE_PROVIDER_UNAVAILABLE` | Yes, after a few minutes | The scene **planner's** model provider was unavailable, overloaded or rate-limited, or the call never received an answer. The brief was not the problem. A *visual review* that gives no usable verdict no longer ends the run this way. A review whose provider was unreachable before it reported any usage is asked again after a bounded pause. A review whose provider broke after it had already streamed usage goes straight to the unreviewed delivery, with no second paid asking. A review that answered unusably is asked once more, and the retry is not billed. If there is still no usable verdict, the assertion-passing scene is delivered unreviewed, with `metadata.review.reason` saying which — see [When a scene that passed is delivered unapproved](#when-a-scene-that-passed-is-delivered-unapproved). |
| `SCENE_PLANNING_TIMEOUT` | Yes | Planning ran past its time bound. Retry, or shorten the brief and reference set. |
| `SCENE_PLANNER_OUTPUT_INVALID` | No, not unchanged | The provider answered, but the recipe it produced could not be accepted by the compiler. Simplify the brief or use fewer references. |

Work already completed before the failure (an earlier repair pass, for
example) is charged as usual; the message never promises a refund it cannot
verify.

#### When a scene that passed is delivered unapproved

A scene whose every **mandatory** check passed can reach you without the visual
reviewer's approval, in two ways. Both **complete**: `videoUrl` is a real MP4,
the credits commit, and what is missing rides along on `metadata.review`
alongside the scene rather than instead of it.

**The reviewer objected.** Its objection drives a correction pass for as long as
the repair budget lasts; once that budget runs out, the composition compiled, it
exported, each assertion the run could *measure* held, and the only thing still
objecting is the reviewer's reading of the rendered frames — so you get the
scene:

| Where | What |
|---|---|
| `metadata.review` | the whole verdict: `{ verdict: "refused", objections[], observed? }` |
| `validation.warnings[]` | one `SCENE_REVIEW_REFUSED` entry per objection, tagged with a `shotId` where the cited frames fall inside one shot |

**Nobody could review it.** The review produced no usable verdict. A repair
cannot help here — a repair answers an objection, and a missing opinion raises
none — so the run does not wait for the repair budget at all. What it does next
depends on why the verdict is missing:

- **The provider was never reached**, and the asking reported no usage. The run
  asks once more after a bounded pause. An asking the provider never answered
  is **unbilled**.
- **The provider broke after it had already streamed usage.** That asking was
  paid for, so it is not asked a second time. The scene is delivered
  unreviewed at once.
- **The provider answered, but with nothing usable**: an answer that failed the
  review contract, one that cited a frame it was never shown, or a refusal that
  was not a transport fault. The run asks once more straight away. The retry is
  **not billed**: the review keeps the one validation charge its first asking
  made.

If there is still no usable verdict, the run delivers the assertion-passing
scene immediately, unreviewed. The delivery bills exactly as the refused one
does — authoring, build, render and export — and the quote's `validation` line
(`Validation frames`) charges only for an asking that reported usage, once per
review batch however many times it was asked, settling at zero when none did.

| Where | What |
|---|---|
| `metadata.review` | `{ verdict: "unavailable", reason, attempts, objections[], observed? }` — `reason` is `"provider"` when no asking reached the provider and `"unusable"` when one did and got nothing usable back; `attempts` is how many times the review was asked, so one unlucky call is distinguishable from a provider that was down throughout |
| `validation.warnings[]` | **leads** with one `SCENE_REVIEW_UNAVAILABLE` entry, then one `SCENE_REVIEW_REFUSED` per surviving objection |

Three things about reading either are worth stating plainly, because the obvious
tests all fail:

- **`validation.status` is still `passed`.** The mandatory checks *did* pass —
  that is precisely why the scene was delivered. Testing the status will not
  find an unapproved delivery.
- **the objection list can be empty.** A refusal that named nothing actionable
  is still a refusal, and `objections: []` reports it honestly instead of
  hiding it. Counting `SCENE_REVIEW_REFUSED` warnings will not find that one
  either.
- **objections under an `unavailable` verdict are not the verdict.** A review is
  batched, and those are whichever batches answered usably before one did not —
  real findings, but not a judgement of the scene. Reading `objections: []`
  there as approval is the same mistake, one step further out.

The presence of `metadata.review` is the reliable test, and `verdict` is what
you branch on:

```typescript
const review = shot.metadata?.review;
if (review?.verdict === "unavailable") {
  // Delivered, and NOBODY judged it: no usable verdict in review.attempts asks.
  // review.reason is "provider" (never reached) or "unusable" (answered with
  // nothing usable). The video is usable; there is simply no opinion on it.
  // Any objections here are partial batches, not a verdict.
  console.log(`unreviewed (${review.reason}) after ${review.attempts} attempts`);
} else if (review) {
  // Delivered, and the reviewer objected. The video is usable; decide whether
  // this particular objection matters to you.
  for (const objection of review.objections) {
    console.log(objection.category, objection.what, objection.correction, objection.frames);
  }
}
```

Each objection carries `category`, `what` (the finding itself), `correction`
(the recipe-level change it asked for, where it named one) and `frames` (the
frames it was looking at). There is no `severity` field — only blocking findings
become objections, so every entry in the list is one. `observed` is the
reviewer's account of what it found *correct*, and is never a substitute for an
objection.

The pinned validation report records the same fact in its own words: it carries
`review: "refused"` or `review: "unavailable"`, so a reader of the delivery can
tell an unreviewed scene from a reviewed one without inferring it from an empty
list of reviews.

**What to do with one.** The scene is a finished result: use it, or treat the
objection as an edit brief. Submitting the same revision as a `scene` source
**with** an `editPrompt` pays for another authoring pass from the delivered
recipe — the `correction` on an objection is written to be usable as that
instruction. Deterministic edits (transform, colour, visibility, shot offsets)
apply to it like any other retained scene and cost no authoring. An *unreviewed*
scene has no correction to work from: re-running the job re-authors the scene
rather than re-reviewing the one you have, so the usable answer is to judge the
MP4 yourself.

#### `SCENE_QUALITY_FAILED` keeps the scene it built

`SCENE_QUALITY_FAILED` is the other ending: the run reached the end of its
budget without a scene it could stand behind. That happens when a **mandatory**
check failed on the last build, or when the compiler refused the recipe outright
— not when the visual reviewer alone objected to a scene that otherwise passed,
and not when the review gave no usable verdict on one, both of which are the
unapproved deliveries above. Where a deployment does *not* deliver unapproved
scenes, an unreviewed one is retained here instead, and its
`validation.warnings[]` leads with `SCENE_REVIEW_UNAVAILABLE` — a failed job
publishes no `metadata` block, so that warning is the only thing that says the
draft was never judged. The job **fails** — there is no MP4, and
`videoUrl`/`resultUrl` are absent rather than empty — but the scene it built is
kept, and the failed job's `output_data` says where:

| Field | Meaning |
|---|---|
| `sceneRevisionId` | The draft revision. A real, readable scene: `GET /v1/3d-scene/revisions/{revisionId}` returns its manifest. |
| `deliveryId` | `GET /v1/3d-scene/deliveries/{jobId}` lists its retained evidence, exactly as it does for a delivered scene. |
| `posterAssetId` | A rendered frame of the draft, read from the delivery's assets route. |
| `validation` | `{ status: "failed", scope: "authored", reportAssetId, passes, warnings[] }` — `passes` is how many authoring passes were spent, and each warning carries a `code`, a `message` and, where the finding cites frames inside one shot, that `shotId`. The reviewer's findings and the run's `SCENE_AUTHORING_ASSUMPTION` entries share this one array; read the `code` to tell them apart (see [Warning codes](#warning-codes)). |
| `repairPasses` | Repairs actually run — `passes` minus the first attempt. |
| `admissionRetries` | Pre-build planner retries, counted apart from the repairs. Reported here too, and absent when the run needed none. |
| `mechanicalPasses` | Repairs the engine applied from the compiler's own remedy with no planner call — counted apart from `repairPasses`, on their own allowance. Reported here too, and absent when the run took none. |
| `restoredAssertions` | Mandatory assertions put back after an answer re-shaped one the feedback did not name. Reported here too, and absent when the run restored none. |
| `scenePlan`, `renderer`, `metadata` | The draft composition and its frame size, fps and duration, plus `metadata.summary` when the planner described what it authored. |

The `reportAssetId` artifact is the reviewer's full account: every finding, its
category and severity, the frames it cites and the correction it asked for.
Read it from the delivery assets route.

Nothing about a kept draft claims it passed. `validation.status` is `failed`
on the job, and the report says `failed` too.

**What you can do with it:**

- **Render it as-is.** Submit it as a scene source with no edit instruction —
  an ordinary render-only run. It re-runs no authoring and no build, and pays
  only for the render and export. That run is a normal completed job, and its
  own `validation` describes the checks a render-only export performs (it says
  so: `scope: "render-only"`, plus a warning that no new visual review was
  done). It does not re-judge, or overturn, the authored quality verdict.
- **Fix it yourself.** Deterministic edits — transform, colour, visibility,
  shot offsets — apply to the draft like any other retained scene and cost no
  authoring credits. Each edit produces a new revision whose provenance names
  the draft it came from.
- **Re-author from it.** Submit it as a scene source **with** an edit
  instruction to pay for another authoring pass from the draft's own recipe.

Retaining costs nothing: no extra render, no extra provider call, and the
settlement is the same one the run would have had.

**On the canvas, by every route.** A refused draft reaches the node the same way
whichever way the run was started, and survives a page reload: the single-node
Run files it live, a full workflow Run carries it on the failed node's
`nodeStates[nodeId].output`, and reopening the workflow re-files it from the job
— together with the failure, which is re-asserted because a node's run status is
not part of the saved workflow. The node shows the draft and the refusal at once;
a scene being present never means the run passed. Whatever the route, the draft
is filed by the same rule a successful revision is: an edit you made while the
run was in flight still wins, and the arriving draft is kept in the node's
revision history rather than overwriting it.

**When nothing could be built at all.** If the compiler refused the recipe on
every pass, there is no scene to keep: no revision, no poster, and no
`sceneRevisionId` — a composition needs geometry and shots, and none was ever
produced. What the run *does* have is the planner's final recipe and the
compiler's reasons for refusing it, and those are kept. `deliveryId` still
resolves: `GET /v1/3d-scene/deliveries/{jobId}` answers for the owner with
`sourceKind: "refused-authoring"` and `sceneRevisionId: null`, and
`output_data.validation` is `{ status: "failed", scope: "authored", phase,
reportAssetId, passes, sourceRetained, warnings[] }`, where `phase` says which stage kept
refusing — `build` when the compiler would not build the recipe, `planning`
when its grammar would not admit one. Each warning is one refusal, naming the
path in the recipe it pointed at where it gave one, alongside any
`SCENE_AUTHORING_ASSUMPTION` entries the run made — the assumptions are about
the authoring, which is the only thing that happened. `repairPasses`,
`admissionRetries`, `mechanicalPasses` and `restoredAssertions` are reported
here too. There is **no** `metadata` block and no `summary`: nothing
compiled, so there is no composition to describe and nowhere honest to put a
description of one. The
report artifact holds the full set, refusal by refusal. A job that failed before
any of that — the planner itself refused, or was never reached — has nothing
to keep, and its `output_data` carries none of these fields.

**The recipe is kept, and you can read it.** `validation.sourceRetained` says
whether there is one: `true` means the last recipe the compiler admitted was
retained, `false` means no pass ever cleared admission and only the report
exists. When it is `true`, `GET /v1/3d-scene/deliveries/{deliveryId}` lists a
descriptor of kind `source-json` (usage `checkpoint`) beside the report, and
`GET /v1/3d-scene/deliveries/{deliveryId}/assets/{assetId}` returns it as JSON.
The SDK does both in one call: `client.scene3d.retainedRecipe(jobId)`, which
answers `null` when there is nothing to fetch.

Two things to know about it:

- **It needs `edit` on the job's workflow**, the same access the `.blend` export
  needs. A reader with less does not see the descriptor at all and gets a `404`
  on the bytes, which is deliberate — there is no response that confirms a recipe
  exists to somebody who may not read it.
- **It is evidence, not an input.** Nothing published a revision, so there is no
  `{kind:"scene"}` source to re-run it from: read it to see what was attempted,
  and let it inform the prompt you send next. Reading it costs no credits.

The scene instruction supports [prompt pre/post text](../../prompt-pre-post-text.md), applied by the canvas when it submits the instruction.

## Credits

3D Render Pro is a single billable operation. What it covers depends on the
source: a new scene pays for authoring, the hosted build and the render; an
existing scene with **no** edit instruction is render-only and pays for neither
authoring nor the build. Each repair pass inside the correction budget is paid
work, which is why the budget is a visible control.

Its price is **deployment configuration**: there is no built-in default, so the
quote endpoint is the authority for any given request, and an install with no
configured price refuses before reserving anything. Quote first and show
`maxCredits` — a ceiling, not a charge.

### The admission-retry allowance

A run's recipe can be refused by the compiler *before* anything is built — a
grammar slip, an edit operation that does not apply. Answering that costs one
more planner call and nothing else: no build, no render, no visual review. It is
a different purchase from a repair pass, which buys another planner call **and**
another build, so it has a budget of its own and a line of its own on the quote:

| `code` | `label` |
|---|---|
| `admission` | `Admission retries (up to 3, planner only)` |
| `mechanical` | `Mechanical passes (up to 2, no planner)` |

Three things to know about it when you show a quote:

- **It is an allowance, not a charge.** The `quantity` on the line is the
  ceiling the run is permitted to spend, so it raises `maxCredits`. Anything
  unspent is released at settlement, exactly like the repair budget — a run that
  never needs a retry pays for none.
- **It is priced at the repair-pass unit** unless your deployment configures a
  separate one. The line exists so the spend is nameable, not so it is priced
  differently by default.
- **It only appears where the deployment quotes it.** An install whose quote
  carries no `admission` line runs as it was quoted, charging the repair budget
  for a pre-build refusal. As everywhere else here: read the quote you were
  given rather than computing one.

The completed result reports what was actually spent as top-level
`admissionRetries`, counted apart from `repairPasses` and never folded into it.

The same allowance and the same line appear on
[Generate 3D Scene](generate-3d-scene.md) when an advanced engine authors it.

### The mechanical-pass allowance

Some of the compiler's refusals arrive with the fix attached: a structured
remedy naming the exact edit that answers the finding. Applying it needs a
**build** and the visual review that reads the result, but **no planner call at
all** — nobody is asked to re-author anything. That is a third distinct
purchase, so it too has a budget of its own and a line of its own:

| `code` | `label` |
|---|---|
| `mechanical` | `Mechanical passes (up to 2, no planner)` |

- **It is an allowance, not a charge**, exactly like the admission line: the
  ceiling raises `maxCredits` and anything unspent is released at settlement. A
  run that never needs one pays for none.
- **It is priced at the build-pass unit**, because a build is what it buys. The
  pass identity stays true — `buildPasses = authoringPasses + repairPasses +
  mechanicalPasses` — and the quote **splits** that number across two lines: the
  `build` line covers `authoring + repair`, the `mechanical` line covers the
  rest, both at the same unit. The credits are what one line at that unit always
  cost; what the split adds is a ceiling the run cannot cross by spending the
  other half.
- **It does not spend your repairs.** That is the point of the line. The two
  repair passes you were quoted stay available for findings the compiler could
  not write an edit for.

The completed result reports what was actually spent as top-level
`mechanicalPasses`, counted **apart** from `repairPasses` and never folded into
it. Because the two budgets are independent, a run may legitimately report more
mechanical passes than repairs.

**One exception, and the quote is what tells you.** A run quoted *before* this
line existed has no `mechanical` line on its quote, and it kept the older
accounting: the pass charged a repair, so there `mechanicalPasses` is a subset
of `repairPasses`. The result reports the same field either way and cannot tell
you which applies — so, as everywhere else here, read the quote you were given
rather than deriving the accounting from the counts.

### Frame size

The render stage is priced **per output frame**, so a longer scene and a higher
frame rate both cost more, in proportion to the frames they produce. The
per-frame rate is tiered by frame size on the same ladder as
[Render Video](render-video.md#what-a-3d-scene-render-costs): frames up to
1920 px on the longest side at the base rate, **1.5x** above that up to 5.12
megapixels, **2.5x** for a larger frame. A frame at or under 1920 px on its
longest side is always base-rate, whatever its shape — raising the frame cap
cannot make a scene you already render more expensive.

The higher rates are derived from your install's own configured base per-frame
price, not set separately, so re-pricing the base moves the whole ladder.

That tier reaches your quote only once the deployment's render engine reports
it in `breakdown` — read the quote you were given rather than computing one, in
every case.

Re-rendering a stored `scenePlan` — through [Render Video](render-video.md), or
through a `{kind:"scene"}` source here — is billed as an ordinary render. You do
not pay to author it again.

Community and Business editions do not use Cloud credit billing and do not
offer this node.

## MCP

The `pro_3d_render` tool exposes the same operation to agents, and is listed
only where the deployment can serve it. See [3D scenes over MCP](../../mcp/3d-scenes.md).
