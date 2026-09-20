/**
 * The volatile part of a studio turn's prompt: what the production looks like
 * right now, what the person can afford, and which scene they are looking at.
 *
 * Two properties decide almost everything in this file.
 *
 * **The read lands nothing.** The person's editor is open, polling and landing
 * every job it started; a second lander here would bring the same finished
 * work in again under its own reading of it. So the summary is read with the
 * landing turned off, and the document is current up to the editor's own save.
 *
 * **The view is not this file's shape.** The studio service owns the
 * production's shape, and the platform deliberately types it as an opaque
 * record. Rendering therefore reads what is THERE — a name, a count, a key,
 * a stage's own fields — and skips what is not, so a view that grows a field
 * reaches the model without an edit here and one that loses a field degrades
 * to a shorter line instead of an exception.
 *
 * **The words ARE this file's: the person's.** The view's keys are the
 * document's — `shots[]`, `still`, `clip`, `beats[]` — and the person never
 * says any of them: in the editor a film is made of SCENES, a scene has a FRAME
 * and a MOTION whose results are takes, and the SHOTS they talk about are the
 * `beats[]` inside a motion. Every line below is written in those words, with
 * one legend line saying which keys they are, because a summary that said
 * "Shots:" and "Selected: shot 2" is what taught the model to answer a
 * question about shot 2 with scene 2 (2026-09-20). The count of shots inside a
 * motion is rendered for the same reason: it is what "shot 2" resolves against,
 * and its absence is what tells the model to ask.
 *
 * Media urls are omitted on purpose: the model cannot look at a picture it is
 * handed as a link, and a url in a prompt is a url that can be repeated back.
 *
 * Like the canvas preamble this rides in the USER message, fenced with a
 * per-turn nonce — every word of it is the person's own writing.
 */
import type { McpInvoker, McpToolCallResult } from "../../lib/mcp/invoke.js"
import { TURN_CAPS } from "./constants.js"
import { listMemories, renderMemoriesSection } from "./memories.js"
import { newUntrustedNonce, stripControlChars } from "./untrusted.js"

/** The answer that means the studio service is not served on this deployment at all. */
const NOT_AVAILABLE_CODE = "not_available"

/** How many `key=value` pairs one nested block contributes to a line. */
const MAX_FIELDS_PER_BLOCK = 4
/** How many entries a list line names before it counts the rest. */
const MAX_LISTED = 12

export interface StudioPreambleInput {
  invoker: McpInvoker
  userId: string
  productionId: string
  /** What the person has selected in the editor, as the message body carried it. */
  focus?: { shotId?: string } | null
}

/**
 * Either the fenced context for this turn, or the verdict that there is no
 * turn to run.
 *
 * The verdict is reached BEFORE the model is called, which is the point of
 * returning it rather than a line of prose: a deployment that cannot serve the
 * production has nothing for the copilot to work on, and paying for a turn to
 * say so is worse than saying so.
 */
export type StudioPreamble =
  | { available: true; text: string }
  | { available: false; code: "studio_not_available" }

export async function buildStudioPreamble(input: StudioPreambleInput): Promise<StudioPreamble> {
  // One parallel call: the read the turn cannot do without, the balance it can,
  // and the person's standing preferences. The balance and the memories are
  // best-effort by construction — neither is worth failing a turn for.
  const [read, balance, memories] = await Promise.all([
    input.invoker.callTool("get_studio_production", {
      production_id: input.productionId,
      detail: "summary",
      reconcile: false,
    }),
    input.invoker.callTool("check_balance", {}).catch(() => null),
    listMemories(input.userId).catch(() => []),
  ])

  if (read.isError) {
    if (errorCodeOf(read) === NOT_AVAILABLE_CODE) return { available: false, code: "studio_not_available" }
    // Any other refusal still leaves a turn worth running: the person can be
    // told what the service said, and the model can answer without the
    // document. It is reported as a line, not hidden.
    return { available: true, text: fence(`The production could not be read: ${textOf(read)}`) }
  }

  const production = recordOf(structuredOf(read)?.production) ?? recordOf(structuredOf(read)) ?? {}
  return { available: true, text: fence(render(production, balance, memories, input.focus ?? null)) }
}

// ── rendering ───────────────────────────────────────────────────────────────

function render(
  production: Record<string, unknown>,
  balance: McpToolCallResult | null,
  memories: Awaited<ReturnType<typeof listMemories>>,
  focus: { shotId?: string } | null,
): string {
  // The document's `shots[]` — SCENES, to the person and in every line below.
  const scenes = arrayOf(production.shots).map(recordOf).filter(isRecord)

  const head: string[] = [headline(production, scenes.length)]
  pushIf(head, "Film", fields(production.film))
  pushIf(head, "Cast", list(arrayOf(production.cast), castEntry))
  pushIf(head, "In flight", fields(production.pending))

  const tail: string[] = []
  pushIf(tail, "Planned frames", list(arrayOf(production.keyframes), namedEntry))
  pushIf(tail, "Sequences", list(arrayOf(production.sequences), namedEntry))
  pushIf(tail, "Cuts", list(arrayOf(production.cuts), namedEntry))
  const balanceLine = balanceOf(balance)
  if (balanceLine) tail.push(balanceLine)
  const selected = focusLine(scenes, focus)
  if (selected) tail.push(selected)
  const memoriesSection = renderMemoriesSection(memories)

  // The scene list is the only part that grows without bound, so it is the only
  // part the cap may take from: everything else — the headline, the balance,
  // the focus, the standing preferences — is what the model needs to answer
  // at all, and a truncation that ate them would leave a longer prompt saying
  // less. Lines are added whole; a scene is listed or counted, never halved.
  // Measured against the join the body below actually uses, so the budget the
  // scene loop spends is the budget there is.
  const withoutScenes = [...head, SCENES_LEGEND, ...tail, memoriesSection].filter(Boolean).join("\n\n")
  let room = TURN_CAPS.contextPreambleMaxChars - withoutScenes.length
  const listed: string[] = []
  for (const [index, scene] of scenes.entries()) {
    const line = sceneLine(scene, index)
    // The overflow line has to fit too, or the last scene in would push it out.
    const overflow = `… and ${scenes.length - index} more scenes`.length + 2
    if (line.length + 1 + overflow > room) break
    listed.push(line)
    room -= line.length + 1
  }
  const remaining = scenes.length - listed.length
  if (remaining > 0) listed.push(`… and ${remaining} more scenes`)

  const body = [
    ...head,
    listed.length > 0 ? `${SCENES_LEGEND}\n${listed.join("\n")}` : "This production has no scenes yet.",
    ...tail,
    memoriesSection,
  ]
    .filter(Boolean)
    .join("\n\n")

  return body
}

/**
 * The heading of the scene list, and the ONE place the two vocabularies meet:
 * the person's words on the left of every line below, the document's keys here,
 * so the model can turn "scene 3" into `shots[2]` and "shot 2" into an entry of
 * that scene's `beats[]` without ever saying a key back to the person.
 */
const SCENES_LEGEND =
  "Scenes, in timeline order (the document's `shots[]`; a scene's frame is its `still`, " +
  "its motion is its `clip`, and the shots inside a motion are its `beats[]`):"

function headline(production: Record<string, unknown>, sceneCount: number): string {
  const name = stringOf(production.name) ?? "Untitled"
  const version = numberOf(production.version)
  const counts = [
    `${sceneCount} ${plural(sceneCount, "scene")}`,
    countLine(production.cast, "cast member"),
    countLine(production.keyframes, "planned frame"),
    countLine(production.cuts, "cut"),
    binLine(production.trash),
    stringOf(production.shared) === undefined && production.shared === true ? "shared by link" : null,
  ].filter((part): part is string => Boolean(part))
  return `Production "${name}"${version === undefined ? "" : ` (version ${version})`} — ${counts.join(", ")}.`
}

/**
 * One scene, by its POSITION — the way the person refers to it and the way the
 * doctrine tells the model to. The id is deliberately included: it is the only
 * thing a tool argument may carry, and the model has to get it from somewhere.
 */
function sceneLine(scene: Record<string, unknown>, index: number): string {
  const parts: string[] = []
  const frame = takesPart(scene.still, "frame")
  const motion = motionPart(scene)
  if (frame) parts.push(frame)
  if (motion) parts.push(motion)
  if (scene.startFrame) parts.push("start frame set")
  if (scene.endFrame) parts.push("end frame set")
  pushPart(parts, "plan", fields(scene.plan))
  pushPart(parts, "look", fields(scene.look))
  pushPart(parts, "voice", fields(scene.voice))
  const name = stringOf(scene.name)
  const id = stringOf(scene.id)
  return `${index + 1}. ${name ? `"${name}"` : "(unnamed)"}${id ? ` [${id}]` : ""}${
    parts.length > 0 ? ` — ${parts.join("; ")}` : ""
  }`
}

/** How many takes a scene's frame (`still`) or motion (`clip`) holds, and which is active. */
interface Takes {
  count: number
  key: string | undefined
}

function takesOf(value: unknown): Takes | null {
  const record = recordOf(value)
  if (!record) return null
  // A count is a count: a view that says -2 has no takes, it does not have "-2 takes".
  const count = Math.max(0, numberOf(record.count) ?? arrayOf(record.results).length)
  // A result is addressed by its key — "the job id, or the url when no job made
  // it". The url form is a MEDIA URL, and this prompt carries none: a take with
  // no job id is counted and has no key the model may repeat.
  const named = stringOf(record.key)
  const key = named && !isUrl(named) ? named : undefined
  return count === 0 && !key ? null : { count, key }
}

/**
 * A scene's frame or motion, as its takes and the ACTIVE key — never the url.
 *
 * A result is addressed by its key everywhere in this family, so the key is
 * what a later tool call needs; the url is what the person is already looking
 * at, and putting it in the prompt only invites it to be repeated.
 */
function takesPart(value: unknown, label: "frame" | "motion"): string | null {
  const takes = takesOf(value)
  if (!takes) return null
  if (takes.count === 0) return `${label}: active ${takes.key}`
  const head = `${label}: ${takes.count} ${plural(takes.count, "take")}`
  return takes.key ? `${head} (active ${takes.key})` : head
}

/** The shots INSIDE a scene's motion — the document's `beats[]`. */
function shotsInside(scene: Record<string, unknown>): number {
  return arrayOf(scene.beats).length
}

/**
 * The motion, with the shots inside it. A motion can be divided into shots
 * before it has a single take, and "shot 2" has to resolve against those too.
 */
function motionPart(scene: Record<string, unknown>): string | null {
  const motion = takesPart(scene.clip, "motion")
  const inside = shotsInside(scene)
  if (inside === 0) return motion
  return `${motion ?? "motion: no take yet"}, ${inside} ${plural(inside, "shot")} inside the motion`
}

/** The scalar fields of one nested block, as the block itself names them. */
function fields(value: unknown): string | null {
  const record = recordOf(value)
  if (!record) return null
  const pairs: string[] = []
  for (const [key, entry] of Object.entries(record)) {
    if (pairs.length >= MAX_FIELDS_PER_BLOCK) break
    const rendered = scalar(entry)
    if (rendered !== null) pairs.push(`${key}=${rendered}`)
  }
  return pairs.length > 0 ? pairs.join(", ") : null
}

/** A scalar the model can read, or nothing. Urls are not scalars for this purpose. */
function scalar(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "string") return isUrl(value) ? null : truncate(value, 60)
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === "string" && !isUrl(entry))
    return entries.length > 0 ? entries.slice(0, MAX_FIELDS_PER_BLOCK).join("/") : null
  }
  return null
}

function castEntry(value: unknown): string | null {
  const record = recordOf(value)
  if (!record) return typeof value === "string" ? value : null
  const label = stringOf(record.slug) ?? stringOf(record.role) ?? stringOf(record.name)
  const name = stringOf(record.name)
  if (!label) return null
  return name && name !== label ? `${label} "${name}"` : label
}

function namedEntry(value: unknown): string | null {
  const record = recordOf(value)
  if (!record) return typeof value === "string" ? value : null
  const id = stringOf(record.id)
  const label = stringOf(record.label) ?? stringOf(record.name)
  const revision = numberOf(record.revision)
  if (!id && !label) return null
  return [id, label ? `"${label}"` : null, revision === undefined ? null : `(revision ${revision})`]
    .filter(Boolean)
    .join(" ")
}

function list(values: unknown[], entry: (value: unknown) => string | null): string | null {
  const rendered = values.map(entry).filter((line): line is string => Boolean(line))
  if (rendered.length === 0) return null
  const shown = rendered.slice(0, MAX_LISTED)
  const rest = rendered.length - shown.length
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ")
}

/**
 * The balance, when it was answered. `check_balance` is the one read this
 * preamble is allowed to lose: a person whose balance could not be read can
 * still be helped, and a turn refused over it would be a turn refused for the
 * wrong reason.
 */
function balanceOf(result: McpToolCallResult | null): string | null {
  if (!result || result.isError) return null
  // The balance tool answers as TEXT — a `{ data: … }` envelope, no structured
  // half — so the text is parsed rather than assumed away. `total` is the
  // spendable number; `balance` is read too so a shape that names it that way
  // still renders instead of silently dropping the line.
  const payload = structuredOf(result) ?? parseJson(textOf(result))
  const body = recordOf(payload?.data) ?? payload
  const value = numberOf(body?.total) ?? numberOf(body?.balance)
  return value === undefined ? null : `Balance: ${value} credits.`
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return recordOf(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * The scene the person is looking at, in their words and with what it HAS.
 *
 * "This shot" and "the second shot" need something to resolve against, and the
 * absence of any shot inside the motion is exactly what tells the model to ask
 * rather than guess — so all three parts are always said, present or not.
 */
function focusLine(scenes: Record<string, unknown>[], focus: { shotId?: string } | null): string | null {
  if (!focus?.shotId) return null
  const index = scenes.findIndex((scene) => stringOf(scene.id) === focus.shotId)
  if (index === -1) return null
  const scene = scenes[index]!
  const name = stringOf(scene.name)
  // The id rides along: on a production long enough for the cap to trim the
  // list, this line is the only place the focused scene is named at all, and
  // the id is the only thing a tool argument may carry.
  const id = stringOf(scene.id)
  const frame = takesOf(scene.still)
  const motion = takesOf(scene.clip)
  const inside = shotsInside(scene)
  const has = [
    frame ? `a frame (${frame.count} ${plural(frame.count, "take")})` : "no frame yet",
    motion ? `a motion (${motion.count} ${plural(motion.count, "take")})` : "no motion yet",
  ].join(", ")
  const shots = inside > 0 ? `${inside} ${plural(inside, "shot")} inside the motion` : "no shots inside the motion"
  return `The person is looking at Scene ${index + 1}${name ? ` ("${name}")` : ""}${id ? ` [${id}]` : ""}: it has ${has} and ${shots}.`
}

// ── the fence ───────────────────────────────────────────────────────────────

/**
 * The same treatment `buildContextPreamble` gives the canvas snapshot, in the
 * same order: strip the nonce out of the body so it cannot be echoed back,
 * strip control characters, then fence. Every line above is the person's own
 * writing — a scene they named, a cast role they wrote — riding in the one
 * channel the model is told to obey.
 */
function fence(body: string): string {
  const nonce = newUntrustedNonce()
  const fenced = stripControlChars(body.split(nonce).join(""))
  return `<workflow-context-${nonce}>\n${fenced}\n</workflow-context-${nonce}>`
}

// ── reading an opaque view ──────────────────────────────────────────────────

function pushIf(lines: string[], label: string, value: string | null): void {
  if (value) lines.push(`${label}: ${value}`)
}

function pushPart(parts: string[], label: string, value: string | null): void {
  if (value) parts.push(`${label}: ${value}`)
}

function countLine(value: unknown, noun: string): string | null {
  const count = arrayOf(value).length
  return count > 0 ? `${count} ${plural(count, noun)}` : null
}

function binLine(value: unknown): string | null {
  const count = numberOf(recordOf(value)?.count)
  return count === undefined || count === 0 ? null : `${count} in the bin`
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function isUrl(value: string): boolean {
  return /^(https?|data|blob):/i.test(value.trim())
}

function textOf(result: McpToolCallResult): string {
  const text = result.content
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
  return text || "(no output)"
}

function structuredOf(result: McpToolCallResult): Record<string, unknown> | null {
  return isRecord(result.structuredContent) ? result.structuredContent : null
}

/** The code a refusal carries, from the structured half or the prose it was rendered as. */
const RENDERED_CODE = /\((\d{3})\s+([a-z][a-z0-9_]*)\)/

function errorCodeOf(result: McpToolCallResult): string | null {
  const structured = structuredOf(result)
  const code = isRecord(structured?.error) ? structured.error.code : undefined
  if (typeof code === "string") return code
  return RENDERED_CODE.exec(textOf(result))?.[2] ?? null
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
