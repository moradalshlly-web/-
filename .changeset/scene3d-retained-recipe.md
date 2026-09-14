---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D makes the recipe a REFUSED authoring run retained retrievable.

A 3D Render Pro run whose recipe the compiler refused on every pass publishes no
scene revision, no poster and no `.blend` — a composition needs geometry and
shots, and the plan is the compiler's own output. The refusal report and the
planner's last admitted recipe are the entirety of what that run produced, and
the recipe was retained and then served nowhere.

- `GET /v1/3d-scene/deliveries/{jobId}` now lists a `source-json` descriptor
  (usage `checkpoint`) beside the refusal report on a `refused-authoring`
  delivery, and `/assets/{assetId}` serves its bytes as `application/json`.
  Reading it needs `edit` on the job's workflow — the same access the `.blend`
  export costs. A reader with less sees no descriptor and gets 404 on the bytes,
  never a 403 that would confirm a recipe exists. Nowhere else does a
  `source-json` become readable: a delivered scene's own recipe is pinned by its
  REVISION, and neither revision read lane lists checkpoint kinds.
- `scene3d.retainedRecipe(jobId)` fetches and parses it in one call, answering
  `null` when the delivery lists none. Read it to see what was attempted and to
  inform the next prompt; there is no input that takes a recipe back, because a
  refused run published no revision to re-run from.
- `Scene3DDeliveryAsset` grows the two kinds the route has always been able to
  return: `shot-still` (with its `shotIndex` / `frame` / `width` / `height`) and
  `source-json`. `deliveryAssetBytes` now checks the kind/usage PAIR against the
  exported `SCENE3D_DELIVERY_ASSET_USAGE` map instead of a hardcoded pair — which
  fixes a real refusal: the SDK rejected every shot still the route would have
  served.
- `Scene3DAuthoringValidation.sourceRetained` is declared: the failed row's own
  flag for whether there is a recipe to fetch, so a caller can tell without a
  round trip. Present on the refused-authoring shape alone, and `false` rather
  than absent when no pass ever cleared admission.

Reading a retained recipe is free, exactly like reading any other delivered
evidence.
