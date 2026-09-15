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

## Catalog (1003 moves across 20 categories)

| Category | Examples |
|---|---|
| **Entrances & Exits** (36) | Walk In From Left, Walk In From Right, Enter From Behind Camera, Approach From Background, Walk Up To Camera, Run Toward Camera, Run In & Stop |
| **Turns & Looks** (37) | Body Turn to Camera, Body Turn Away, Quarter Turn to Profile, Turn Profile to Camera, Full 360 Spin, Pivot on Heel, Twist to Look Behind |
| **Head Gestures** (31) | Eager Nodding, Firm Single Nod, Knowing Nod, Chin-Up Nod, Nod of Thanks, Listening Nods, Disbelieving Head Shake |
| **Walks & Runs** (40) | Casual Stroll, Brisk Walk, Power Walk, Confident Stride, Jog, Sprint, Tiptoe |
| **Runway & Model** (32) | Runway Walk, Walk & Turn, Mid-Stride Pivot, Editorial Stomp, Campaign Walk, High-Fashion Walk, Stop & Pose |
| **Dance** (56) | Hip-Hop Groove, Sway to the Music, Arms-Up Sway, Clap Along, Two-Step, Grapevine, Raise the Roof |
| **Face & Expression** (59) | Break Into Smile, Creeping Smile, Grin Widens, Smile Fades, Forced Smile, Smirk, Burst Out Laughing |
| **Gestures** (101) | Wave Hello, Wave Goodbye, Thumbs Up, Thumbs Down, Beckon, Stop Hand, Salute |
| **Camera Interaction** (44) | Look Into Lens, Hold Gaze Then Look Away, Approach Camera, Lean Into Lens, Walk Past Camera, Point at Camera, Show Object to Lens |
| **Combat & Weapons** (67) | Draw Pistol, Raise & Aim Pistol, Fire Pistol, Fire Rifle, Aim Down Sights, Reload Magazine, Rack the Slide |
| **Athletic & Stunts** (71) | Vertical Jump, Leap Across Gap, Box Jump, Precision Jump, Backflip, Front Flip, Cartwheel |
| **Evasive & Falls** (43) | Duck Under, Sidestep Dodge, Lean-Back Dodge, Flinch, Startled Jump Back, Dive for Cover, Duck Behind Cover |
| **Posture Shifts** (46) | Sit on Chair, Sit on Floor, Stand from Chair, Stand from Floor, Kneel Down, Take a Knee, Rise from Kneeling |
| **Everyday Actions** (91) | Take a Sip, Drink from Bottle, Cradle Mug and Sip, Take a Bite, Put On Jacket, Take Off Jacket, Put On Sunglasses |
| **Vehicles & Mounts** (32) | Get Into Car, Get Out of Car, Slide Across Hood, Drive Off, Shift Gears, Check Mirror & Turn, Lean Out Window |
| **Animals & Pets** (28) | Pet a Dog, Scratch Behind Ears, Ruffle Dog Fur, Scoop Up Pet, Offer Hand to Sniff, Offer a Treat, Get Pulled by Leash |
| **Two-Person** (76) | Hug, Long Embrace, High Five, Bro Hug, Run Into Arms, Bury Face, Handshake |
| **Idle & Ambient** (41) | Breathe Visibly, Sway Subtly, Shift Weight, Fidget With Hands, Blink Naturally, Look Around, Tap Foot |
| **Stage & Performance** (42) | Sing Into Handheld Mic, Sing at Stand Mic, Belt a High Note, Hold Note Eyes Closed, Mic Out to Crowd, Rap Into the Mic, Strum Guitar |
| **Unnatural & Horror** (30) | Head Twitch, Tilt Head Too Far, Snap Head Sideways, Backbend Crawl, Crawl Head Raised, Stiff Board Rise, Contort Limbs |

Two defaults round out the catalog: `auto` and `none`, which inject nothing.

## Target and partner

Two input handles accept a **Character**, **Face**, **Object**, **Creature** or **Location** reference:

- **`target`** — its name replaces every "the subject" in the composed text.
- **`partner`** — its name replaces every "the partner" in two-person moves (hug, handshake, slow dance, tackle). When nothing is wired, the partner reads **"another person"**.

Two references wired to the same handle are joined with "and". An unwired `target` leaves "the subject" in place, and the video model fills it in from what is in frame.

## Worked example

Picks `walk-in-from-left`, `wave-hello`, `hug-partner`; Position `start`; Pace `slow`; a Character named **Mira** on `target`; a Character named **Theo** on `partner`.

Full hint mode:

> Mira walks into frame from the left edge at an even stride, weight rolling heel to toe, crosses toward center and stops facing forward, then Mira lifts one hand to shoulder height, palm forward, and waves it side to side in a friendly greeting before letting the arm drop back to the side, then Mira steps toward Theo, opens both arms and wraps them around Theo's back in a firm hug, holds the hug, and loosens the arms to step back, the movement begins at the opening of the clip, performed slowly and deliberately, each phase of the movement given its full time

Compact hint mode (the short term for each move; the target is named by prefix, and the partner inside the term):

> Mira: walks in from frame left, then waves hello, then hugs Theo, the movement begins at the opening of the clip, performed slowly and deliberately, each phase of the movement given its full time

## Inputs & Outputs

**Inputs:**
- `target` — optional; a character / face / object / creature / location reference that names the subject.
- `partner` — optional; a character / face / object / creature / location reference that names the second person.

**Outputs:**
- `out` — the composed prompt fragment, consumed by AI video nodes on their `cinematography` / `look` handle.

## Video only

Character Motion is never injected into a still-image node (Generate Image, Edit Image, Image to Image, Modify Image, Location). The add-node popup does not offer it on those nodes' Look handle.

## Minor-age floor

Moves marked adult-only (sultry looks, body rolls, kisses) are left out of the prompt when a Character wired to `target` or `partner` is a minor.

## Best Practices

- Order matters: pick the entrance first, the gesture second, the reaction third.
- Wire a Character to `target` so every move names the same person.
- For more than three beats, chain two Character Motion nodes into the same video node — or split the shot.
- Pair with [Camera Motion](./camera-motion.md): a walk toward the camera with a slow dolly-out reads as one choreographed shot.
- Use `slow-motion` for stylized action beats and `natural` for dialogue scenes.

## Tips

- The composer rewrites "the subject" and "the partner" globally, so possessives read naturally ("Theo's back").
- `auto` and `none` are skipped inside a multi-pick.
- Short clips (4–6 seconds) carry one or two moves well; three moves need a longer clip.

## See Also

- [Pose](./pose.md) — a single held position instead of movement.
- [Character FX](./character-fx.md) — supernatural effects on the subject.
- [Camera Motion](./camera-motion.md) — how the camera moves.
- [Character](../assets/character.md) — the reference source for `target` and `partner`.
