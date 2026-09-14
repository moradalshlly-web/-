/**
 * What a DELIVERY hands back, kind by kind, source kind by source kind, access by access.
 *
 * The revision lanes have `authorize.test.ts`'s totality guard; this is its delivery half, and
 * it exists because the delivery lane stopped being a single flat allowlist. One kind —
 * `source-json`, the recipe a run that never compiled was refused for — is readable on ONE
 * source kind at ONE access level, and the whole hazard of that shape is a later change making
 * it readable somewhere else by accident. So the table below iterates every combination rather
 * than asserting the cases somebody thought of.
 */
import { describe, expect, it } from "vitest"
import { scene3DDeliveryArtifactReadable } from "../delivery-authorize.js"
import {
  SCENE3D_RETAINED_RECIPE_KIND,
  SCENE3D_RETAINED_RECIPE_MIN_ACCESS,
  type Scene3DDeliveryArtifact,
  type Scene3DDeliveryRecord,
  type Scene3DDeliverySourceKind,
} from "../delivery-types.js"
import { SCENE3D_ARTIFACT_KINDS, SCENE3D_ARTIFACT_KIND_USAGE, SCENE3D_ARTIFACT_USAGES,
  type Scene3DArtifactKind, type Scene3DArtifactUsage } from "../types.js"
import type { AccessLevel } from "../../../lib/workflow-access.js"

const SOURCE_KINDS: readonly Scene3DDeliverySourceKind[] = ["retained-revision", "job-output", "refused-authoring"]
const ACCESS: readonly AccessLevel[] = ["none", "view", "edit", "own"]
/** Every kind a delivery may serve, whatever the source kind or the access. */
const ALWAYS_SERVED: readonly Scene3DArtifactKind[] = ["poster", "validation-report", "shot-still"]

function delivery(sourceKind: Scene3DDeliverySourceKind): Scene3DDeliveryRecord {
  return {
    jobId: "job", userId: "owner", workflowId: null, sourceKind, sourceRevisionId: "rev",
    sourcePlanSha256: sourceKind === "refused-authoring" ? null : "a".repeat(64),
    sourceContentHash: null, sourceJobId: null, sourceOwnerId: "owner", sourceWorkflowId: null,
    mode: sourceKind === "job-output" ? "render-only" : "authored", createdAt: "2026-09-14T00:00:00Z",
  }
}

function pin(kind: Scene3DArtifactKind, usage: Scene3DArtifactUsage = SCENE3D_ARTIFACT_KIND_USAGE[kind]): Scene3DDeliveryArtifact {
  return {
    artifactId: "asset", userId: "owner", kind, bucket: "private-scenes", objectKey: "k",
    sha256: "b".repeat(64), byteLength: 10, etag: "tag", expiresAt: null,
    createdAt: "2026-09-14T00:00:00Z", usage, viaRevisionId: null,
    shotIndex: null, frame: null, width: null, height: null,
  }
}

describe("the delivery read lane is total", () => {
  it("serves exactly the three delivered kinds, plus the retained recipe on its one lane", () => {
    for (const kind of SCENE3D_ARTIFACT_KINDS) {
      for (const sourceKind of SOURCE_KINDS) {
        for (const access of ACCESS) {
          const readable = scene3DDeliveryArtifactReadable(pin(kind), delivery(sourceKind), access)
          const expected = ALWAYS_SERVED.includes(kind)
            || (kind === SCENE3D_RETAINED_RECIPE_KIND && sourceKind === "refused-authoring"
              && (access === SCENE3D_RETAINED_RECIPE_MIN_ACCESS || access === "own"))
          expect(readable, `${kind} / ${sourceKind} / ${access}`).toBe(expected)
        }
      }
    }
  })

  it("keeps every OTHER private kind off the lane at every access", () => {
    // `blend-source`, `glb`, `camera-track-json`, `build-manifest`, `input-glb`: none of them
    // is a delivery's business, and `own` does not change that. Only the recipe moved.
    for (const kind of SCENE3D_ARTIFACT_KINDS) {
      if (ALWAYS_SERVED.includes(kind) || kind === SCENE3D_RETAINED_RECIPE_KIND) continue
      for (const sourceKind of SOURCE_KINDS) {
        expect(scene3DDeliveryArtifactReadable(pin(kind), delivery(sourceKind), "own"),
          `${kind} / ${sourceKind}`).toBe(false)
      }
    }
  })

  it("refuses a pin whose usage does not match its kind, recipe included", () => {
    // Defense in depth, as on the revision lanes: one column agreeing is never enough. A
    // recipe pinned as `poster` is refused even on the lane that would have served it.
    for (const usage of SCENE3D_ARTIFACT_USAGES) {
      if (usage === "checkpoint") continue
      expect(scene3DDeliveryArtifactReadable(
        pin(SCENE3D_RETAINED_RECIPE_KIND, usage), delivery("refused-authoring"), "own")).toBe(false)
    }
    for (const usage of SCENE3D_ARTIFACT_USAGES) {
      if (usage === "poster") continue
      expect(scene3DDeliveryArtifactReadable(pin("poster", usage), delivery("retained-revision"), "own")).toBe(false)
    }
  })
})
