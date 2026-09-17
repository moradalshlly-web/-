---
name: infinite-zoom
description: One unbroken push-in across N generated clips — each clip ends deep inside a planted detail, the next opens on that same surface at macro scale, joined frame-exact with Smart Cut; includes a deterministic still-zoom variant that costs no generation credits
triggers: ["infinite zoom", "endless zoom", "continuous zoom video", "zoom into the detail", "zoom through", "recursive zoom", "droste effect", "keeps zooming in", "world inside a world", "picture inside a picture video", "scale transition", "zoom transition video", "never ending zoom"]
version: 1
---

# Infinite Zoom

The camera never stops moving inward. Clip 1 pushes into one small detail of its
own frame; clip 2 opens ON that detail at macro scale and pushes into a detail of
its own; repeat. Hard-cut together, N clips read as one continuous zoom with no
bottom.

Two ideas carry the whole method:

1. **The handoff frame is exact.** Each clip's own end frame IS the next clip's
   start frame (`extract-frame` → `startFrame`). Nothing is re-described at the
   boundary, so the picture cannot jump. What can still break is MOTION
   continuity — speed, direction, and whether the new world obeys the old
   surface. That is what the prompt rules below buy you.
2. **The new world is the old surface.** The detail you enter does not open a
   portal into somewhere else. It becomes the same surface at macro scale — a
   woven thread becomes a landscape of ropes, never a forest. A portal reads as
   a cut; a surface reads as a zoom.

## The graph

1. **Level 1 frame** — `text-prompt` → `generate-image`. Set the aspect ratio
   HERE; every later frame inherits it from the chain. A user upload works the
   same way. The frame must contain the detail level 2 will enter, already
   visible and already small.
2. **Per level** (N times) — the frame's `image` → `generate-video`.`startFrame`,
   with one prompt per level written from `references/zoom-prompt.md`. The same
   `model`, `duration` and `resolution` on every clip in the chain. Longer clips
   mean fewer seams: a model that holds 15-30s in one shot buys a calmer film
   than six 5s clips.
3. **Per level** — the clip's `video` → `extract-frame`,
   `mode: "frame-from-end"`, `framesFromEnd: 3`, its `image` → the NEXT
   `generate-video`.`startFrame`. **Never `mode: "last"`.** The final frames of a
   generated clip are the mushiest in it (tail dissolve, compression smear) and
   that mush would become the next clip's entire world.
4. **Join** — all N clips → `combine-videos` with `transition: "cut"`,
   `transitionDuration: 0`, `smartCutEnabled: true`,
   `smartCutMode: "preroll-keep-prev"`, and an explicit `clipOrder` in level
   order. Smart Cut exists for exactly this shape: continuation models re-enact
   the handoff moment on both sides of the seam, and `preroll-keep-prev` keeps
   the previous clip's sharper original frames and drops the re-enactment.
   (Smart Cut is a Nodaro Cloud feature; self-hosted editions fall back to the
   fixed trims, start 1 / end 2.)
5. **Tail (optional)** — `video-upscale`, or one unbroken drone bed through
   `merge-video-audio`. Never per-level music: a cut in the audio re-introduces
   the edit the picture just hid.

## The four seam rules

These are the wording rules that decide whether a level reads as a zoom or as an
edit. They were measured on reproduction runs (an analyser and composer
rebuilding an existing zoom-through commercial), so treat them as prompt
wording that works, not as a guarantee on a from-scratch world.

1. **No device words.** Never write `cut`, `match cut`, `transition`, `warp`,
   `whip` or `dissolve` in a clip prompt. Those words tell the model an EDIT
   happens here, and it will render one. The vocabulary is `continuous`,
   `seamless`, `unbroken`, `single take`.
2. **The becomes-half names the same surface.** Say what the detail becomes in
   its own terms: "the embroidered flower becomes the same embroidery at macro
   scale". Never name a new object ("becomes a metal couch") and never name a
   new place ("becomes a landscape of giant rope loops") — both plant a portal,
   and the render obeys the portal.
3. **Plant the detail before you enter it.** The outgoing clip must SHOW the
   next subject, stitch-sized, in frame, before the zoom arrives at it. A detail
   that only exists in the next prompt is a new scene, not a destination.
4. **The camera names where the detail sits.** "Slow push in onto the white
   flower at lower frame left", not "push in". A bare push-in dollies dead
   centre, and the detail drifts out of the zoom's path.

## Hard rules

- **Uniformity is the effect.** One model, one duration, one resolution, one
  aspect across the whole chain. A model swap mid-chain is visible as a texture
  change at exactly the frame you are trying to hide.
- **Never wire a blend.** `fade`, `dissolve` or any non-zero
  `transitionDuration` in `combine-videos` turns the seam into an admitted edit.
  Hard cut, always.
- **Frames, not references.** Wire `extract-frame` → `startFrame`. On
  reference-capable models, wiring image references alongside a start frame
  flips the run into reference mode and can surrender the frame contract — call
  `get_node_skill("generate-video")` before adding any reference input.
- **One level at a time.** Run level 1, look at its extracted frame, and only
  then build level 2. Every clip is a paid generation and a bad frame poisons
  every level after it. Do not author the whole chain in one call.
- **Keep the rate constant.** Same zoom-speed language and same duration in
  every clip. A clip that arrives at rest, or that starts by holding still,
  reads as a new shot however good the frame match is.
- **Three levels is a film.** N=3 at the model's longest single-shot duration is
  the cheapest thing that already reads as endless. Go wider only after the
  user has seen three.

## Phase 0 — Ask first

1. The opening world, and what the FIRST detail is that the camera will enter.
2. Level count (default 3) and per-clip duration (default: the model's longest
   single shot).
3. Aspect ratio, and whether this is photoreal or graphic — graphic worlds
   should read the deterministic variant below instead.
4. Does it need to CLOSE the loop? A loop means the last clip arrives back at
   the opening frame: wire the level-1 image into the final clip's `endFrame`
   (on a model that accepts a paired last frame) and keep everything else the
   same.

## Deterministic variant — still zoom, no model luck

For graphic, illustrated or Droste-style zooms, skip generation entirely:
`modify-image` (outpaint one level wider) → `still-to-video` with
`motion: "zoom-in"` → `combine-videos` with `transition: "cut"`.

What the zoom actually does, so you can plan the levels: `still-to-video` runs
the zoom from 1.0 to `min(1 + rate * frames, 1.5)` — a hard 1.5x ceiling per
clip — where `intensity` 1 to 10 maps linearly to a per-frame rate of 0.0002 to
0.0015. The window is always CENTRED: you cannot zoom toward an off-centre
detail, so compose every level with its next detail dead centre. `still-to-video`
costs no credits, so the whole chain is free to iterate.

Its one weakness: `modify-image` outpainting has no exact expansion ratio, so a
level boundary only vanishes if the outpaint happens to match the achieved zoom
factor. Expect a small pop at each join, and prefer this route where the artwork
can absorb it.

## Credit posture

Every `generate-video` level is a paid run. Propose the chain, state the level
count and per-clip cost, and let the user approve before the first run. When a
level comes back wrong, re-roll that ONE level — never rebuild the chain.
