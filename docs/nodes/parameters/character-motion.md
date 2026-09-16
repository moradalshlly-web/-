# Character Motion

> Direct what the subject does across an AI video clip — walk in, turn to the camera, nod, wave, dance, duck, draw and fire, walk a runway — as an ordered sequence of up to three moves.

## Overview

The Character Motion parameter node describes the subject's **movement over time** and injects it into the prompt of a connected AI video node. It is temporal by definition, which is what separates it from its neighbours:

- **[Pose](./pose.md)** — a single held body position (also used for still images).
- **[Character FX](./character-fx.md)** — a supernatural change to the subject (werewolf, fire breath).
- **[Action FX](./action-fx.md)** — an event in the scene (explosion, lightning).
- **[Camera Motion](./camera-motion.md)** — the camera moves, not the subject.

Picks form a **sequence**: the first move happens, then the second, then the third.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Character Motion | multi-select | `"auto"` | One move id, or an ordered array of 1–3 ids. The picks are joined with `, then ` in the order they were picked. |
| Position | select | `"auto"` | When the movement happens: `auto` / `start` / `middle` / `end` / `full`. |
| Pace | select | `"auto"` | The tempo: `auto` / `slow-motion` / `slow` / `natural` / `fast` / `explosive`. |
| Pre Text | text | empty | Free-form text placed before the composed fragment. |
| Post Text | text | empty | Free-form text placed after the composed fragment. |
| Hint mode | select | `full` | Which fragment this picker injects downstream — `full` = the long descriptive hint, `compact` = the short professional term. See [Prompt hint mode](./README.md#prompt-hint-mode). |

`auto` contributes no text in every field.

Position and Pace are catalogs, not free values: the `character-motion` picker catalog exposes them as `dimensions` beside its `options` (`GET /v1/picker-catalogs/character-motion`, `client.pickerCatalogs.get("character-motion")`, the MCP `get_picker_catalog` tool, or `CHARACTER_MOTION_POSITIONS` / `CHARACTER_MOTION_PACES` from `@nodaro/prompts`). Each row carries the exact clause it injects. Where ids overlap with [Transition](./transition.md) and [Character FX](./character-fx.md), the wording is still this node's own — a movement *begins* or *plays out*. See [Parameter Picker Catalogs](../../picker-catalogs.md#single-dimension-pickers-with-secondary-parameters-transition-character-fx-character-motion).

## Catalog (1054 moves across 20 categories)

| Category | Examples |
|---|---|
| **Entrances & Exits** (36) | Walk in from left, Walk in from right, Enter from behind camera, Approach from background, Walk up to camera |
| **Turns & Looks** (40) | Body turn to camera, Body turn away, Quarter turn to profile, Turn profile to camera, Full 360 spin |
| **Head Gestures** (32) | Eager nodding, Firm single nod, Knowing nod, Chin-up nod, Nod of thanks |
| **Walks & Runs** (44) | Casual stroll, Brisk walk, Power walk, Confident stride, Jog |
| **Runway & Model** (32) | Runway walk, Walk & turn, Mid-stride pivot, Editorial stomp, Hip-sway walk |
| **Dance** (56) | Hip-hop groove, Sway to the music, Arms-up sway, Clap along, Two-step |
| **Face & Expression** (59) | Break into smile, Creeping smile, Grin widens, Smile fades, Forced smile |
| **Gestures** (103) | Wave hello, Wave goodbye, Thumbs up, Thumbs down, Beckon |
| **Camera Interaction** (44) | Look into lens, Hold gaze then look away, Approach camera, Lean into lens, Walk past camera |
| **Combat & Weapons** (67) | Draw pistol, Raise & aim pistol, Fire pistol, Fire rifle, Aim down sights |
| **Athletic & Stunts** (74) | Vertical jump, Leap across gap, Box jump, Precision jump, Backflip |
| **Evasive & Falls** (43) | Duck under, Sidestep dodge, Lean-back dodge, Flinch, Startled jump back |
| **Posture Shifts** (52) | Sit on chair, Sit on floor, Stand from chair, Stand from floor, Kneel down |
| **Everyday Actions** (104) | Take a sip, Drink from bottle, Sip from a cradled mug, Take a bite, Put on jacket |
| **Vehicles & Mounts** (41) | Get into driver seat, Get out of car, Slide across hood, Drive off, Shift manual gears |
| **Animals & Pets** (38) | Pet a dog, Scratch behind ears, Ruffle dog fur, Scoop up pet, Offer hand to sniff |
| **Two-Person** (80) | Hug, Long embrace, Hug from behind, Bro hug, Run into arms |
| **Idle & Ambient** (42) | Breathe visibly, Sway subtly, Shift weight, Fidget with hands, Blink naturally |
| **Stage & Performance** (42) | Sing into handheld mic, Sing at stand mic, Belt a high note, Hold note eyes closed, Mic out to crowd |
| **Unnatural & Horror** (25) | Head twitch, Snap head sideways, Backbend crawl, Stiff board rise, Contort limbs |

Two defaults round out the catalog: `auto` and `none`, which inject nothing.

## Target and partner

Two input handles accept a **Character**, **Face**, **Object**, **Creature** or **Location** reference:

- **`target`** — its name replaces every "the subject" in the composed text.
- **`partner`** — its name replaces every "the partner" in two-person moves (hug, handshake, slow dance, tackle). When nothing is wired, a human partner is introduced once as **"another person"**, and every later mention by the same target — later in the same move, or in a later move of the sequence — reads **"that same person"**, so one Partner handle stays one person for that performer. Animal, dependent-person and object moves with a `counterpart` declaration also use this handle: it replaces `the counterpart`, or falls back to the declared recipient (for example, a dog or a baby), introduced and referred back to the same way. A named reference identifies the recipient; it does not prove that its species, size or props match the move.

Multiple targets each receive a separate singular clause in both modes; Compact mode prefixes each clause with its target name. Each target performs a separate copy of the sequence, so with the Partner handle unwired each copy introduces its own **"another person"** — two targets are two performers acting on a partner each, never both on one person. Use separate nodes for coordinated choreography. Multiple Partner names are joined with "and". An unwired `target` leaves "the subject" in place, and the video model fills it in from what is in frame.

## Worked example

Picks `walk-in-from-left`, `wave-hello`, `hug-partner`; Position `start`; Pace `slow`; a Character named **Mira** on `target`; a Character named **Theo** on `partner`.

Full hint mode:

> Mira walks into frame from the left edge at an even stride, weight rolling heel to toe, crosses toward center and stops facing forward, then Mira lifts one hand to shoulder height, palm forward, and waves it side to side in a friendly greeting before letting the arm drop back to the side, then Mira steps toward Theo, opens both arms and wraps them around Theo's back in a firm hug, holds the hug, and loosens the arms to step back, the movement begins at the opening of the clip, performed slowly and deliberately, each phase of the movement given its full time

Compact hint mode (the short term for each move; the target is named by prefix, and the partner inside the term):

> Mira: walks in from frame left, then waves hello, then hugs Theo, the movement begins at the opening of the clip, performed slowly and deliberately, each phase of the movement given its full time

## Inputs & Outputs

**Inputs:**
- `target` — optional; a character / face / object / creature / location reference that names the subject.
- `partner` — optional; a character / face / object / creature / location reference that names a second person, animal, dependent participant, gaze target or object, according to the selected motion.

**Outputs:**
- `out` — the composed prompt fragment, consumed by AI video nodes on their `cinematography` / `look` handle.

## Video only

Character Motion is never injected into a still-image node (Generate Image, Edit Image, Image to Image, Modify Image, Location). The add-node popup does not offer it on those nodes' Look handle.

## Minor-age floor

Moves marked adult-only (explicitly sensual looks and kissing variants) are left out of the prompt when a Character wired to `target` or `partner` is a minor.

The flag is an editorial minor-age exclusion, not a general age rating. Neutral dance, removing a coat over an outfit, and ordinary hugs remain available. The preview reports omitted selections, including when every selected fragment is omitted.

## Sequence review and prerequisites

The picker supports up to three ordered selections. Use the up/down buttons to reorder and Remove to clear an item. At capacity, adding another choice leaves the current sequence intact. Search includes former titles and authored aliases. Retired choices remain resolvable for saved workflows; `mount-the-horse` points reviewers to `mount-horse`.

The preview uses the same graph-aware composer as execution, including names, hint mode, minor filtering, timing, and pre/post text. It is the **contributed fragment**, not the final generation prompt. Other prompt nodes, references, policies and provider preparation can alter the final request.

Diagnostics report declared pose transitions, leaving frame before another action, occupied hands, fixed timing versus Pace, prerequisites, a reference connected as both Target and Partner, retired/unknown IDs, and compound choreography. These are advisory editor messages; they do not disable Run. An unknown ID still contributes nothing, and minor-filtered moves stay omitted. Fix red attention messages before running. Missing metadata means unknown, not compatible. Not every legacy entry has state or prerequisite metadata yet.

`getCharacterMotionDiagnostics(value, timing, bindings)` exposes the same checks from `@nodaro/prompts`; `getCharacterMotionBindings(node, graph)` supplies the names and minor flag used by composition. Discovery options expose optional `motion` metadata (`requires`, states, aliases, `counterpart`, `kind`, `fixedPace`, deprecation/replacement). The review tool shows unannotated fields explicitly.

A compound move can contain many phases. Three selections are a UI cap, not a duration budget. No minimum clip lengths or provider success rates have been validated. Confirm the subject anatomy, supporting surfaces, clothing, objects and additional participants in the scene. A reference connected to a naming handle does not itself guarantee downstream reference-media support.

## Offline catalog review

Run `npx tsx tools/character-motion-review.ts /tmp/character-motion-review.html` from the repository root. Open the generated file in a browser. It contains every base entry, actual Full/Compact composer previews, sequence examples and per-field Keep/Edit decisions, plus explicit Reviewed and proposed Deprecation states. Proposals do not change deployed catalogs.

Export decisions to JSON. Browser-only storage is not a backup. Imports compare the source commit and content fingerprint plus per-field hashes: changed fields lose approval and require review, while unchanged decisions survive. This tool makes no model calls and spends no generation credits.

## Best Practices

- Order matters: pick the entrance first, the gesture second, the reaction third.
- Wire a Character to `target` so every move names the same person.
- For longer choreography, split the shot and review the end/start states of each clip. Adding motion nodes does not establish timing between their fragments.
- Pair with [Camera Motion](./camera-motion.md): a walk toward the camera with a slow dolly-out reads as one choreographed shot.
- Use `slow-motion` for stylized action beats and `natural` for dialogue scenes.

## Tips

- The composer rewrites "the subject" and "the partner" globally, so possessives read naturally ("Theo's back").
- `auto` and `none` are skipped inside a multi-pick.
- Test complex moves on the selected provider before relying on choreography. A singing fragment describes visible performance; synchronized lyrics need audio and a suitable lip-sync workflow.
- Camera-relative directions refer to the frame; subject-relative directions are explicitly named. Review them alongside Camera Motion, especially for exits or tracking shots.

## See Also

- [Pose](./pose.md) — a single held position instead of movement.
- [Character FX](./character-fx.md) — supernatural effects on the subject.
- [Camera Motion](./camera-motion.md) — how the camera moves.
- [Character](../assets/character.md) — the reference source for `target` and `partner`.
