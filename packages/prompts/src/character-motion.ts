/**
 * Canonical catalog of CHARACTER MOTION choices — what the subject DOES across
 * a video clip: walks in, turns to camera, breaks into a smile, ducks, draws and
 * fires, runway-walks, dances. Temporal by definition.
 *
 * Distinct from:
 *  - Pose            — a static SNAPSHOT of body position (serves still images too).
 *  - Character FX    — supernatural change to the subject's body (werewolf, fire breath).
 *  - Action FX       — a scene event (explosion, lightning); motion is the BODY acting.
 *  - Camera Motion   — the camera moves, never the subject.
 *
 * Shared between the picker UI, the standalone Character Motion parameter node,
 * and the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator. Video-only: never injected into still-image consumers.
 *
 * Every non-empty `promptHint` references "the subject" at least once — the
 * composer does a global regex replace of "the subject" with the wired target's
 * display name. Two-person moves ALSO contain the literal words "the partner",
 * replaced with the wired partner's name, or "another person" when unwired.
 *
 * Multi-pick is an ORDERED SEQUENCE: value field accepts `string | string[]`
 * (cap 3), joined with ", then " in BOTH hint modes (a movement happens after
 * the previous one; Character FX joins with ", and " because effects coincide).
 *
 * `adultOnly` marks the W1-a minor-age floor. The composer drops flagged ids
 * when its caller reports a minor subject (`floor.subjectMinor`); the AI Fill
 * strip drops them from analyzer output. Hand-curated; the `adult-only-ratchet`
 * test only ratchets. Never set on neutral movement or the `auto` / `none` heads.
 */

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"
export type { CharacterMotion, CharacterMotionCategory, CharacterMotionMetadata } from "./character-motion/types.js"
import type { CharacterMotion, CharacterMotionCategory } from "./character-motion/types.js"
import { ENTRANCES_EXITS_MOTIONS } from "./character-motion/entrances-exits.js"
import { TURNS_LOOKS_MOTIONS } from "./character-motion/turns-looks.js"
import { HEAD_GESTURES_MOTIONS } from "./character-motion/head-gestures.js"
import { WALKS_RUNS_MOTIONS } from "./character-motion/walks-runs.js"
import { RUNWAY_MOTIONS } from "./character-motion/runway.js"
import { DANCE_MOTIONS } from "./character-motion/dance.js"
import { FACE_EXPRESSION_MOTIONS } from "./character-motion/face-expression.js"
import { GESTURES_MOTIONS } from "./character-motion/gestures.js"
import { CAMERA_INTERACTION_MOTIONS } from "./character-motion/camera-interaction.js"
import { COMBAT_WEAPONS_MOTIONS } from "./character-motion/combat-weapons.js"
import { ATHLETIC_STUNTS_MOTIONS } from "./character-motion/athletic-stunts.js"
import { EVASIVE_FALLS_MOTIONS } from "./character-motion/evasive-falls.js"
import { POSTURE_SHIFTS_MOTIONS } from "./character-motion/posture-shifts.js"
import { EVERYDAY_ACTIONS_MOTIONS } from "./character-motion/everyday-actions.js"
import { VEHICLES_MOUNTS_MOTIONS } from "./character-motion/vehicles-mounts.js"
import { ANIMALS_PETS_MOTIONS } from "./character-motion/animals-pets.js"
import { TWO_PERSON_MOTIONS } from "./character-motion/two-person.js"
import { IDLE_AMBIENT_MOTIONS } from "./character-motion/idle-ambient.js"
import { STAGE_PERFORMANCE_MOTIONS } from "./character-motion/stage-performance.js"
import { UNNATURAL_HORROR_MOTIONS } from "./character-motion/unnatural-horror.js"

export const CHARACTER_MOTION_CATEGORY_ORDER: ReadonlyArray<CharacterMotionCategory> = [
  "entrances-exits",
  "turns-looks",
  "head-gestures",
  "walks-runs",
  "runway",
  "dance",
  "face-expression",
  "gestures",
  "camera-interaction",
  "combat-weapons",
  "athletic-stunts",
  "evasive-falls",
  "posture-shifts",
  "everyday-actions",
  "vehicles-mounts",
  "animals-pets",
  "two-person",
  "idle-ambient",
  "stage-performance",
  "unnatural-horror",
] as const

export const CHARACTER_MOTION_CATEGORY_LABELS: Readonly<Record<CharacterMotionCategory, string>> = {
  "entrances-exits": "Entrances & Exits",
  "turns-looks": "Turns & Looks",
  "head-gestures": "Head Gestures",
  "walks-runs": "Walks & Runs",
  "runway": "Runway & Model",
  "dance": "Dance",
  "face-expression": "Face & Expression",
  "gestures": "Gestures",
  "camera-interaction": "Camera Interaction",
  "combat-weapons": "Combat & Weapons",
  "athletic-stunts": "Athletic & Stunts",
  "evasive-falls": "Evasive & Falls",
  "posture-shifts": "Posture Shifts",
  "everyday-actions": "Everyday Actions",
  "vehicles-mounts": "Vehicles & Mounts",
  "animals-pets": "Animals & Pets",
  "two-person": "Two-Person",
  "idle-ambient": "Idle & Ambient",
  "stage-performance": "Stage & Performance",
  "unnatural-horror": "Unnatural & Horror",
} as const

/**
 * The catalog: two no-op heads + every category array, in category order.
 * Authored injecting entries across 20 categories.
 */
export const CHARACTER_MOTIONS: ReadonlyArray<CharacterMotion> = [
  // Defaults — both inject nothing (empty promptHint ⇒ empty term).
  { id: "auto", label: "Auto", category: "entrances-exits", description: "Let the model choose the movement", promptHint: "" },
  { id: "none", label: "None", category: "entrances-exits", description: "No scripted character movement", promptHint: "" },
  ...ENTRANCES_EXITS_MOTIONS,
  ...TURNS_LOOKS_MOTIONS,
  ...HEAD_GESTURES_MOTIONS,
  ...WALKS_RUNS_MOTIONS,
  ...RUNWAY_MOTIONS,
  ...DANCE_MOTIONS,
  ...FACE_EXPRESSION_MOTIONS,
  ...GESTURES_MOTIONS,
  ...CAMERA_INTERACTION_MOTIONS,
  ...COMBAT_WEAPONS_MOTIONS,
  ...ATHLETIC_STUNTS_MOTIONS,
  ...EVASIVE_FALLS_MOTIONS,
  ...POSTURE_SHIFTS_MOTIONS,
  ...EVERYDAY_ACTIONS_MOTIONS,
  ...VEHICLES_MOUNTS_MOTIONS,
  ...ANIMALS_PETS_MOTIONS,
  ...TWO_PERSON_MOTIONS,
  ...IDLE_AMBIENT_MOTIONS,
  ...STAGE_PERFORMANCE_MOTIONS,
  ...UNNATURAL_HORROR_MOTIONS,
]

const characterMotionById = new Map<string, CharacterMotion>(
  CHARACTER_MOTIONS.map((m) => [m.id, m]),
)

export function getCharacterMotion(id: string | undefined | null): CharacterMotion | undefined {
  if (!id) return undefined
  return overlayEntry("character-motion", id, characterMotionById.get(id))
}

export function getCharacterMotionLabel(id: string | undefined | null, fallback?: string): string {
  const m = getCharacterMotion(id)
  if (m) return m.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getCharacterMotionPromptHint(id: string | undefined | null): string {
  return getCharacterMotion(id)?.promptHint ?? ""
}

/** Compact counterpart of `getCharacterMotionPromptHint` — same lookup, same
 *  empty-string-on-miss, and the no-op `auto` / `none` heads inject nothing. */
export function getCharacterMotionTerm(id: string | undefined | null): string {
  return resolveTerm(getCharacterMotion(id))
}

export const CHARACTER_MOTION_IDS: ReadonlyArray<string> = CHARACTER_MOTIONS.map((m) => m.id)

/** Cap on ordered picks. Shared by the composer (`.slice(0, N)`), the picker
 *  (`maxSelected`) and the config panel — the three must agree. */
export const CHARACTER_MOTION_MAX_PICKS = 3

// ---------------------------------------------------------------------------
// Timing scales — Position + Pace. Own wording; NOT the character-fx or the
// transition rows (an effect manifests, a transition occurs, a MOVEMENT is
// performed). `POSITION_CLAUSES` / `PACE_CLAUSES` are DERIVED from these arrays
// so the clause the composer injects and the hint the catalog advertises are
// the same string by construction.
// ---------------------------------------------------------------------------

export interface CharacterMotionTimingOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  readonly term?: string
}

export const CHARACTER_MOTION_POSITIONS = [
  { id: "auto",   label: "Auto",   description: "Let the model place the movement",          promptHint: "", term: "" },
  { id: "start",  label: "Start",  description: "Begins at the opening of the clip",         promptHint: "the movement begins at the opening of the clip", term: "starting as the clip opens" },
  { id: "middle", label: "Middle", description: "Begins midway through the clip",            promptHint: "the movement begins midway through the clip", term: "starting midway through the clip" },
  { id: "end",    label: "End",    description: "Happens in the closing moments of the clip", promptHint: "the movement happens in the closing moments of the clip", term: "in the closing moments of the clip" },
  { id: "full",   label: "Full",   description: "Plays out across the entire clip",          promptHint: "the movement plays out across the entire clip", term: "playing out across the whole clip" },
] as const satisfies ReadonlyArray<CharacterMotionTimingOption>

export const CHARACTER_MOTION_PACES = [
  { id: "auto",        label: "Auto",        description: "Let the model set the tempo",                          promptHint: "", term: "" },
  { id: "slow-motion", label: "Slow Motion", description: "The action itself is rendered in slow motion",         promptHint: "the action is rendered in slow motion, every phase of the movement stretched and drawn out", term: "in slow motion" },
  { id: "slow",        label: "Slow",        description: "Performed slowly and deliberately",                    promptHint: "performed slowly and deliberately, each phase of the movement given its full time", term: "slow and deliberate" },
  { id: "natural",     label: "Natural",     description: "Performed at an everyday tempo",                       promptHint: "performed at a natural everyday tempo, neither rushed nor drawn out", term: "at a natural everyday tempo" },
  { id: "fast",        label: "Fast",        description: "Performed quickly, brisk and urgent",                  promptHint: "performed quickly, with brisk urgent tempo and sharp transitions between phases", term: "fast and brisk" },
  { id: "explosive",   label: "Explosive",   description: "A sudden burst from stillness into full-speed motion", promptHint: "performed with an explosive burst of energy, snapping from stillness into full-speed motion", term: "with an explosive burst" },
] as const satisfies ReadonlyArray<CharacterMotionTimingOption>

export type CharacterMotionPosition = (typeof CHARACTER_MOTION_POSITIONS)[number]["id"]
export type CharacterMotionPace     = (typeof CHARACTER_MOTION_PACES)[number]["id"]

export interface CharacterMotionTiming {
  position?: CharacterMotionPosition
  pace?:     CharacterMotionPace
}

/** Private twin of the helper in character-fx.ts / transitions.ts — the
 *  catalogs must stay independent. Total over the array by construction. */
function clausesOf<T extends CharacterMotionTimingOption>(
  options: ReadonlyArray<T>,
): Record<Exclude<T["id"], "auto">, string> {
  return Object.fromEntries(
    options.filter((o) => o.id !== "auto").map((o) => [o.id, o.promptHint]),
  ) as Record<Exclude<T["id"], "auto">, string>
}

const POSITION_CLAUSES = clausesOf(CHARACTER_MOTION_POSITIONS)
const PACE_CLAUSES     = clausesOf(CHARACTER_MOTION_PACES)

/** Widening guard — `as const` on the two arrays is load-bearing (see character-fx.ts). */
type NarrowIds<T> = string extends T ? never : true
const _timingIdsStayNarrow: [NarrowIds<CharacterMotionPosition>, NarrowIds<CharacterMotionPace>] = [true, true]
void _timingIdsStayNarrow

// ---------------------------------------------------------------------------
// Graph-aware composer — target + partner handles, ordered multi-pick, timing
// ---------------------------------------------------------------------------

const PARTNER_FALLBACK = "another person"

/** What the caller knows about the wired target. `subjectMinor: true` drops
 *  every `adultOnly` pick after the cap; otherwise the output is unchanged. */
export interface CharacterMotionFloor {
  readonly subjectMinor?: boolean
}

/**
 * Compose a character-motion prompt fragment from an ORDERED list of 1–3 move
 * ids, the display names wired to the `target` and `partner` handles, and the
 * optional Position / Pace timing.
 *
 * Full mode: each hint has "the subject" rewritten to the target name(s) (only
 * when a target is wired) and "the partner" rewritten to the partner name (or
 * "another person" — ALWAYS, so the literal words "the partner" never ship);
 * both BEFORE the ", then " join. Compact mode: terms joined with ", then ",
 * prefixed `"{target}: "` when a target is wired. A term never contains "the
 * subject" (the prefix names the target) but a two-person term always contains
 * "the partner", which is substituted exactly as in full mode.
 * Timing clauses follow in the fixed order position, pace, in both modes.
 * `floor.subjectMinor` drops adult-only picks after the cap; none left ⇒ "".
 */
export function composeCharacterMotionHintFromConnections(
  motionId: string | ReadonlyArray<string> | undefined | null,
  targetHints: ReadonlyArray<string>,
  partnerHints: ReadonlyArray<string>,
  timing?: CharacterMotionTiming,
  mode: PickerHintMode = "full",
  floor?: CharacterMotionFloor,
): string {
  const picked = Array.isArray(motionId)
    ? Array.from(new Set(motionId as ReadonlyArray<string>)).slice(0, CHARACTER_MOTION_MAX_PICKS)
    : motionId ? [motionId as string] : []
  // Cap the user's picks FIRST, then floor: a dropped pick never lets a later one backfill.
  const ids = floor?.subjectMinor === true
    ? picked.filter((id) => getCharacterMotion(id)?.adultOnly !== true)
    : picked
  const resolveBase = mode === "compact" ? getCharacterMotionTerm : getCharacterMotionPromptHint
  const entries = ids.map((id) => ({ id, base: resolveBase(id) })).filter((e) => e.base.length > 0)
  if (entries.length === 0) return ""

  const targets = [...new Set(targetHints.filter((h) => h && h.length > 0))]
  const targetClause = targets.join(" and ")
  const partnerClause = partnerHints.filter((h) => h && h.length > 0).join(" and ")
  const partnerName   = partnerClause || PARTNER_FALLBACK

  const substituted = entries.map(({ id, base }) => {
    // One pass with a callback: names are literal data, never replacement
    // syntax ($&, $`, $') or a second set of template tokens to reprocess.
    const substitute = (target: string) => base.replace(/\bthe (subject|partner|counterpart)\b/g, (token, role: string) => {
      if (role === "subject") return mode !== "compact" && target ? target : token
      if (role === "partner") return partnerName
      return partnerClause || getCharacterMotion(id)?.counterpart || "the other participant"
    })
    // Each actor receives a grammatical singular clause. Do not invent a
    // plural choreography or attach a singular verb to a joined name list.
    return targets.length > 1
      ? targets.map(target => mode === "compact" ? `${target}: ${substitute(target)}` : substitute(target)).join("; separately, ")
      : substitute(targetClause)
  })

  const joined = substituted.join(", then ")
  const combinedBase = mode === "compact" && targets.length === 1 ? `${targetClause}: ${joined}` : joined
  const parts: string[] = [combinedBase]
  if (timing?.position && timing.position !== "auto") parts.push(POSITION_CLAUSES[timing.position])
  if (timing?.pace     && timing.pace     !== "auto") parts.push(PACE_CLAUSES[timing.pace])
  return parts.join(", ")
}
