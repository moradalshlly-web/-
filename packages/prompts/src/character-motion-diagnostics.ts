import { getCharacterMotion, CHARACTER_MOTION_MAX_PICKS, type CharacterMotionTiming } from "./character-motion.js"

export interface CharacterMotionDiagnostic {
  readonly code: "unknown" | "omitted" | "retired" | "pose" | "visibility" | "hands" | "pace" | "requirements" | "compound" | "capacity" | "multiple-targets" | "roles"
  readonly severity: "error" | "warning" | "info"
  readonly ids: readonly string[]
  readonly message: string
}
export interface CharacterMotionBindings {
  readonly selfPairing?: boolean
  readonly subjectMinor?: boolean
  readonly partnerNames?: readonly string[]
  readonly targetNames?: readonly string[]
}

/** Shared by editor, API clients and local review. Missing metadata means
 * unknown; this never certifies a sequence or predicts clip duration. */
export function getCharacterMotionDiagnostics(
  value: string | readonly string[] | null | undefined,
  timing?: CharacterMotionTiming,
  bindings: CharacterMotionBindings = {},
): readonly CharacterMotionDiagnostic[] {
  const requested = typeof value === "string" ? [value] : Array.isArray(value) ? [...new Set(value)] : []
  const result: CharacterMotionDiagnostic[] = []
  const add = (code: CharacterMotionDiagnostic["code"], severity: CharacterMotionDiagnostic["severity"], ids: readonly string[], message: string) => result.push({ code, severity, ids, message })
  if (requested.length > CHARACTER_MOTION_MAX_PICKS) add("capacity", "warning", requested, "Only the first three selections contribute. Remove extra selections.")
  const picks = requested.slice(0, CHARACTER_MOTION_MAX_PICKS)
  for (const id of picks) if (!getCharacterMotion(id)) add("unknown", "error", [id], `Motion “${id}” is unavailable and contributes no fragment. Remove or replace it.`)
  const entries = picks.flatMap(id => { const entry = getCharacterMotion(id); return entry?.promptHint ? [entry] : [] })
  const active = entries.filter(e => !bindings.subjectMinor || !e.adultOnly)
  if (bindings.selfPairing && active.some(e => e.twoPerson || e.counterpart)) add("roles", "error", active.filter(e => e.twoPerson || e.counterpart).map(e => e.id), "The same reference is connected as Target and Partner. Connect distinct participants before running this interaction.")
  const omitted = entries.filter(e => bindings.subjectMinor && e.adultOnly)
  if (omitted.length) add("omitted", active.length ? "warning" : "error", omitted.map(e => e.id), `${omitted.map(e => e.label).join(", ")} omitted for a connected minor. ${active.length ? "Replace these selections." : "No selected motion contributes a fragment."}`)
  if ((bindings.targetNames?.length ?? 0) > 1) add("multiple-targets", "warning", picks, "Each target performs a separate copy of the sequence. Use separate motion nodes for coordinated choreography.")
  for (const entry of active) {
    if (entry.deprecated) add("retired", "warning", [entry.id], `${entry.label} is retired from new choices but still resolves in saved workflows.${entry.replacementId ? ` Use ${getCharacterMotion(entry.replacementId)?.label ?? entry.replacementId}.` : ""}`)
    if (entry.fixedPace && timing?.pace && timing.pace !== "auto") add("pace", "warning", [entry.id], `${entry.label} sets its own timing. Set Pace to Auto or replace the motion.`)
    if (entry.requires?.length) add("requirements", "info", [entry.id], `${entry.label} requires: ${entry.requires.join(", ")}.${entry.twoPerson || entry.counterpart ? bindings.partnerNames?.length ? ` Partner reference: ${bindings.partnerNames.join(", ")}; confirm it matches the required recipient.` : " Connect a Partner reference to identify the recipient; otherwise the model chooses it." : " Establish these in the scene or prompt; the fragment does not supply reference media."}`)
  }
  for (let i = 1; i < active.length; i++) {
    const before = active[i - 1]!, after = active[i]!, ids = [before.id, after.id]
    if (before.endVisibility === "out-of-frame") add("visibility", "warning", ids, `${before.label} ends out of view before ${after.label}. Reorder or add an entrance.`)
    if (before.endPose && after.startPose && before.endPose !== "any" && after.startPose !== "any" && before.endPose !== after.startPose) add("pose", "warning", ids, `${before.label} ends ${before.endPose}; ${after.label} starts ${after.startPose}. Add a transition or replace a motion.`)
    if (before.handsAfter && before.handsAfter !== "free" && after.needsFreeHands) add("hands", "warning", ids, `${before.label} leaves hands occupied; ${after.label} needs free hands. Add a release first.`)
  }
  const compound = active.filter(e => e.kind === "compound")
  if (compound.length) add("compound", "warning", compound.map(e => e.id), `${compound.length} selection${compound.length === 1 ? " is" : "s are"} compound choreography. Short clips may not fit every phase; test the sequence before adding more actions.`)
  return result
}
