/**
 * The run-time node-availability backstop in buildPayload asks WHO the run
 * belongs to.
 *
 * The admin switch hides a node from the deployment's users. The run executes
 * as a specific user — an app run as its runner, a scheduled run as the
 * workflow's owner — and `node-executor.ts` hands that user's viewer in through
 * `PayloadBuildContext.viewer`. An admin's run keeps a hidden node; a user's
 * run (including a user running an admin-built app or template) fails with the
 * coded `node_not_available`. A caller that names no viewer is a USER — the
 * admin's view is never the default.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { ADMIN_VIEWER, USER_VIEWER, type AvailabilityViewer } from "../../../lib/surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
  GATEABLE_NODE_TYPES,
} from "../../../lib/availability-override.js"

beforeAll(() => __availabilityUniverseReadyForTests())

afterEach(() => {
  __resetAvailabilityOverridesForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const node: SimpleNode = {
  id: "gi-1",
  type: "generate-image",
  data: { provider: "nano-banana", prompt: "a red bird on a branch" },
}

/** The stored override: everything on except `generate-image`. */
function hideFromUsers(): void {
  __resetAvailabilityOverridesForTests({
    nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => t !== "generate-image")),
  })
}

/** The error code buildPayload throws for this run, or undefined when it builds. */
function codeFor(viewer: AvailabilityViewer | undefined): string | undefined {
  try {
    buildPayload(node, "job-1", {}, undefined, { nodes: [node], edges: [], nodeStates: {}, ...(viewer ? { viewer } : {}) })
    return undefined
  } catch (e) {
    return (e as { code?: string }).code
  }
}

describe("buildPayload — node availability is asked as the run's own user", () => {
  it("a user's run of a hidden node fails with node_not_available", () => {
    hideFromUsers()
    expect(codeFor(USER_VIEWER)).toBe("node_not_available")
  })

  it("a run that names NO viewer is a user's run — the admin view is never the default", () => {
    hideFromUsers()
    expect(codeFor(undefined)).toBe("node_not_available")
    // …and the same holds with no build context at all.
    expect(() => buildPayload(node, "job-1", {})).toThrow(/not available on this deployment: generate-image/)
  })

  it("an admin's run of a hidden node is not refused for availability", () => {
    hideFromUsers()
    expect(codeFor(ADMIN_VIEWER)).not.toBe("node_not_available")
  })

  it("an admin's run still fails for a node the deployment PROFILE removed", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    expect(codeFor(ADMIN_VIEWER)).toBe("node_not_available")
  })

  it("inert when nothing is hidden", () => {
    expect(codeFor(USER_VIEWER)).not.toBe("node_not_available")
    expect(codeFor(undefined)).not.toBe("node_not_available")
  })
})
