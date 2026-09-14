import type { Scene3DArtifactPublishInput, Scene3DPinnedArtifact } from "./types.js"

export const SCENE3D_DELIVERY_KINDS = ["poster", "validation-report", "shot-still"] as const
export type Scene3DDeliveryKind = (typeof SCENE3D_DELIVERY_KINDS)[number]

/**
 * The retained recipe of a run that never compiled — the ONE checkpoint kind a delivery serves.
 *
 * It is deliberately not a member of {@link SCENE3D_DELIVERY_KINDS}. Only a `refused-authoring`
 * delivery ever pins a `source-json` (`scene3d_publish_delivery` refuses the kind outright, so
 * the paid lane cannot acquire one), and a flat widening would say the opposite: that any
 * delivery may hand back any checkpoint. The gate below is therefore a conjunction of three
 * facts, not a list membership — the kind, the source kind that produced it, and the access a
 * caller holds.
 *
 * Why it is served at all: when the compiler refuses a recipe on every pass there is no
 * revision, no poster and no `.blend`. The recipe and the refusal report ARE the run's whole
 * output, and retaining the recipe while refusing to hand it back left the owner with a
 * sentence and nothing to act on (measured on staging jobs 9e8b79ee and 58aa5006, 2026-09-11).
 * A delivered scene's own recipe stays private exactly as before: it is pinned by the REVISION,
 * and neither revision read lane lists `checkpoint` kinds.
 */
export const SCENE3D_RETAINED_RECIPE_KIND = "source-json"

/**
 * Reading the retained recipe costs `edit`, like the `.blend` export and for the same reason
 * (`SCENE3D_SOURCE_MIN_ACCESS`): a collaborator invited to WATCH a workflow may read what a run
 * produced, not walk off with the authoring input behind it.
 */
export const SCENE3D_RETAINED_RECIPE_MIN_ACCESS = "edit" as const
/**
 * `refused-authoring` is the one source that is not a scene.
 *
 * The other two deliver a composition somebody can open: a retained revision, or a Basic
 * export's own job output. A Pro run whose recipe the compiler refused on every pass has
 * neither — a v2 manifest needs at least one asset and one shot, and the plan is the
 * compiler's output, so nothing was ever published to point at. What the run DOES have is
 * the planner's final recipe and the compiler's reasons for refusing it, and this kind is how
 * those reach their owner instead of being dropped.
 */
export type Scene3DDeliverySourceKind = "retained-revision" | "job-output" | "refused-authoring"
export type Scene3DDeliveryMode = "render-only" | "authored"

export interface Scene3DDeliveryRecord {
  jobId: string
  userId: string
  workflowId: string | null
  sourceKind: Scene3DDeliverySourceKind
  /** On `refused-authoring` this is the attempt identity the artifacts were written under —
   *  a namespace, not a published revision. The read route reports no scene for that kind. */
  sourceRevisionId: string
  /** Null on `refused-authoring` alone: there is no plan, so there is no plan digest. */
  sourcePlanSha256: string | null
  sourceContentHash: string | null
  sourceJobId: string | null
  sourceOwnerId: string
  sourceWorkflowId: string | null
  mode: Scene3DDeliveryMode
  createdAt: string
}

export interface Scene3DDeliveryArtifact extends Scene3DPinnedArtifact {
  viaRevisionId: string | null
  /** Set on `shot-still` pins only, and always set on those. */
  shotIndex: number | null
  frame: number | null
  width: number | null
  height: number | null
}

export interface Scene3DDeliveryPublishInput {
  jobId: string
  userId: string
  revisionId: string
  source: { kind: Scene3DDeliverySourceKind; jobId?: string }
  mode: Scene3DDeliveryMode
  plan: unknown
  artifacts: Array<
    Omit<Scene3DArtifactPublishInput, "kind" | "expiresAt"> & {
      kind: Scene3DDeliveryKind
      /** Required on a `shot-still`, refused on anything else. */
      shotIndex?: number
      frame?: number
      /** Optional: the composition's own frame size when the producer omits it. */
      width?: number
      height?: number
    }
  >
}

/**
 * Publishing the evidence of authoring that never compiled.
 *
 * No plan and no poster, because neither exists. `revisionId` is the attempt identity the
 * report and recipe were reserved under, which is what binds them to this parent's upload
 * intents; no revision row is read, and none is required to exist.
 *
 * Both artifacts are reachable afterwards: the report to anyone who can read the delivery, the
 * recipe to a reader with `edit` — see {@link SCENE3D_RETAINED_RECIPE_KIND}.
 */
export interface Scene3DRefusedDeliveryPublishInput {
  jobId: string
  userId: string
  revisionId: string
  source: { kind: "refused-authoring" }
  mode: "authored"
  artifacts: Array<
    Omit<Scene3DArtifactPublishInput, "kind" | "expiresAt"> & {
      /** Exactly one report; the recipe is optional, and readable by an owner or editor
       *  through the delivery routes — see {@link SCENE3D_RETAINED_RECIPE_KIND}. */
      kind: "validation-report" | "source-json"
    }
  >
}

export interface Scene3DDeliveryPublishResult {
  deliveryId: string
  revisionId: string
  status: "created" | "unchanged"
  artifactIds: string[]
}
