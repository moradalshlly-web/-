# Prompt formulas — infinite zoom

## The per-level clip prompt

One prompt per level, same seven lines every time. Only the world words change.

```
<WORLD>: <what the frame already shows, in one sentence>.
One continuous shot, <N> seconds, single unbroken take, the camera never cuts
and never leaves its spot.
A single uninterrupted push in from a wide view to an extreme macro framing,
moving onto <DETAIL> at <PLACE IN FRAME>, which fills the whole image by the
end.
<DETAIL> stays <ITS OWN MATERIAL> throughout and becomes the same
<MATERIAL> at macro scale as the camera closes in.
The move is one constant speed, never slowing, never settling, still travelling
inward on the last frame.
Depth of field shortens and the image grows softer and grainier as the lens
pushes long; fine texture, dust and micro-shadow build with it.
<MOOD AND LIGHT>, photoreal, real footage.
```

Line by line: the world you already have · single-take assertion · the move,
with the detail's PLACE IN FRAME · the same-surface promise · constant rate ·
optics that build with the push · mood. Nothing else belongs in it.

Two lines do the load-bearing work:

- **The place line.** "onto the white embroidered flower at lower frame left"
  beats "push in" every time — a bare push-in dollies dead centre and loses the
  detail. Name the quadrant.
- **The same-surface line.** The detail becomes ITSELF bigger. Never a new
  object, never a new place.

## The plant sentence

Every clip must show the NEXT level's subject, stitch-sized, before the camera
reaches it. Append one sentence to the clip prompt:

```
Somewhere in <DETAIL>, far too small to read yet, <NEXT DETAIL> is already
visible.
```

Without the plant, the next level is a new scene however well the frames match.

## The negative list

Same negative prompt on every clip in the chain:

```
cut, match cut, transition, dissolve, fade, warp, whip pan, camera shake,
camera pulling back, camera stopping, new location, new scene, split screen,
text, watermark
```

Every word there is a way of asking for an edit. `camera pulling back` and
`camera stopping` are in the list because a model that finishes the move leaves
you a frame with nowhere to go.

## Worked chain — three levels

The rule to copy is the CHAIN, not the wool.

**Level 1.** World: a woman in a heavy wool coat on a winter street, hands in
her pockets. Detail: one raised loop of yarn on the sleeve cuff, at frame
right. Same-surface line: the loop stays wool and becomes the same wool at
macro scale. Plant: inside the loop, far too small to read yet, a single
twisted fibre is already visible.

**Level 2.** Opens on that loop, now the size of a rope bridge. Detail: one
twisted fibre crossing the frame, lower centre. Same-surface line: the fibre
stays the same fibre and becomes the same twist at macro scale. Plant: along
the fibre, too small to read yet, the overlapping scales of its surface are
already visible.

**Level 3.** Opens on the fibre. Detail: one scale of its surface, centre
frame. Same-surface line: the scale stays the same surface and becomes the same
plating at macro scale. Plant: only if a level 4 is coming.

What makes the chain work: every level's subject is a PART of the level above
it, named in the level above it, in the same material. Nothing new is ever
introduced at a seam.

## Closing the loop

To make the zoom endless rather than merely long, the last level must arrive
back at the opening frame. Wire the level-1 image into the final clip's
`endFrame` (on a model that accepts a paired last frame) and end the prompt
with: `the surface opens out onto the opening view again, one continuous move`.
Join the last clip to the first in `combine-videos` and the film loops with no
visible entry point.

## Settings that carry the effect

- `extract-frame`: `mode: "last"` on every handoff. Only a loop-closing clip
  with a pinned `endFrame` uses `mode: "frame-from-end"`, `framesFromEnd: 3`.
- `combine-videos`: `transition: "cut"`, `transitionDuration: 0`,
  `smartCutEnabled: true`, `smartCutMode: "preroll-keep-prev"`, explicit
  `clipOrder`.
- `generate-video`: identical `model`, `duration` and `resolution` on every
  level. Put the single-take and negative lines in `promptSuffix` and
  `negativePrompt` so they cannot drift between levels.
