---
"@nodaro/prompts": minor
---

Transitions: instant (cut) rows take no duration.

`Transition` gains an optional `instant?: boolean`, set on the eight rows whose mechanism is a cut — `none` (hard cut), `snap-to-black`, `match-cut`, `smash-cut`, `seamless-match` (invisible cut), `jump-cut`, `jump-match` (match cut on a jump) and `action-relay` (match cut on action). New export `isInstantTransition(id | ids)` — true when the id (or, for a multi-pick, EVERY picked id) is instant; unknown / `auto` / empty are false.

`composeTransitionHintFromConnections` now drops the duration clause ("lasting approximately 1 second", including `instant`'s "occurring instantaneously") when every picked transition is instant: a duration on a cut made video models render a dissolve. Position and intensity clauses still apply. A mixed pick (a cut plus a non-cut) keeps its duration. Consumers (the canvas transition picker, Studio) can read `isInstantTransition` to hide the duration lever for these rows.

`PickerOption` gains `instant?: true`, carried on the transition picker catalog's cut rows (`getPickerCatalog("transition").options`), so a client that reads only the wire catalog (`/v1/picker-catalogs/transition`) can hide the Duration lever for cuts. The field is absent on every other row and catalog; a row a catalog pack adds carries it only when the pack's own option does.
