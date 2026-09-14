import { accessAtLeast, workflowAccess, type AccessLevel } from "../../lib/workflow-access.js"
import { isScene3DId } from "./object-keys.js"
import { loadScene3DDelivery, loadScene3DDeliveryArtifacts } from "./delivery-db.js"
import {
  SCENE3D_DELIVERY_KINDS,
  SCENE3D_RETAINED_RECIPE_KIND,
  SCENE3D_RETAINED_RECIPE_MIN_ACCESS,
  type Scene3DDeliveryRecord,
  type Scene3DDeliveryArtifact,
} from "./delivery-types.js"
import { SCENE3D_ARTIFACT_KIND_USAGE } from "./types.js"
import type { Scene3DDenial } from "./authorize.js"

export type Scene3DDeliveryAuthorization =
  | { ok: true; delivery: Scene3DDeliveryRecord; access: AccessLevel }
  | Scene3DDenial

async function scopeAccess(actorId: string, ownerId: string, workflowId: string | null): Promise<AccessLevel> {
  return workflowId ? workflowAccess(actorId, workflowId) : actorId === ownerId ? "own" : "none"
}

/** Both anchors survive source revision deletion. Absence never grants access. */
export async function authorizeScene3DDelivery(actorId: string, jobId: string): Promise<Scene3DDeliveryAuthorization> {
  if (!isScene3DId(jobId)) return { ok: false, reason: "not-found" }
  const delivery = await loadScene3DDelivery(jobId)
  if (!delivery) return { ok: false, reason: "not-found" }
  const ownAccess = await scopeAccess(actorId, delivery.userId, delivery.workflowId)
  if (ownAccess === "none") return { ok: false, reason: "not-found" }
  const sourceAccess = await scopeAccess(actorId, delivery.sourceOwnerId, delivery.sourceWorkflowId)
  if (sourceAccess === "none") return { ok: false, reason: "not-found" }
  const access = accessAtLeast(ownAccess, sourceAccess) ? sourceAccess : ownAccess
  return { ok: true, delivery, access }
}

/**
 * Whether THIS delivery, read at THIS access level, may hand back these bytes.
 *
 * Three facts, and the kind alone is never one of them on its own:
 *
 *   1. the pin's `usage` must be the one its kind is defined to have, so a `source-json`
 *      mis-pinned as `poster` is refused before anything else is asked;
 *   2. the kind must be on the delivery allowlist — or be the retained recipe of a delivery
 *      whose source kind is `refused-authoring`, which is the only lane that pins one;
 *   3. the recipe additionally costs `edit`, like the `.blend` export.
 *
 * One function, because both the list route and the byte route ask it — including the
 * post-read re-authorization in `serveArtifact`, which re-asks the whole question rather than
 * trusting the answer it got before the stream opened.
 */
export function scene3DDeliveryArtifactReadable(
  artifact: Scene3DDeliveryArtifact,
  delivery: Scene3DDeliveryRecord,
  access: AccessLevel,
): boolean {
  if (SCENE3D_ARTIFACT_KIND_USAGE[artifact.kind] !== artifact.usage) return false
  if ((SCENE3D_DELIVERY_KINDS as readonly string[]).includes(artifact.kind)) return true
  return artifact.kind === SCENE3D_RETAINED_RECIPE_KIND
    && delivery.sourceKind === "refused-authoring"
    && accessAtLeast(access, SCENE3D_RETAINED_RECIPE_MIN_ACCESS)
}

export async function authorizeScene3DDeliveryArtifact(
  actorId: string, jobId: string, artifactId: string,
): Promise<{ ok: true; delivery: Scene3DDeliveryRecord; artifact: Scene3DDeliveryArtifact; access: AccessLevel } | Scene3DDenial> {
  if (!isScene3DId(artifactId)) return { ok: false, reason: "not-found" }
  const auth = await authorizeScene3DDelivery(actorId, jobId)
  if (!auth.ok) return auth
  const artifact = (await loadScene3DDeliveryArtifacts(jobId))
    .find((item) => item.artifactId === artifactId
      && scene3DDeliveryArtifactReadable(item, auth.delivery, auth.access))
  // Not-found and not forbidden, deliberately: an artifact this caller may not read is
  // indistinguishable from one that does not exist, so a reader without `edit` learns nothing
  // about whether a recipe was retained at all.
  if (!artifact) return { ok: false, reason: "not-found" }
  return { ok: true, delivery: auth.delivery, artifact, access: auth.access }
}
