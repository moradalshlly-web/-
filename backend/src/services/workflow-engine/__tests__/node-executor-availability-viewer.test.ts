/**
 * node-executor → payload-builder THREADING of the availability viewer.
 *
 * The admin switch (Admin → Availability) hides a node from users, not from
 * admins, and `buildPayload`'s run-time backstop is synchronous — so
 * `executeNode` resolves who the EXECUTION belongs to (`ctx.userId`: an app run
 * executes as its runner, a scheduled run as the workflow's owner) and hands the
 * answer down as `PayloadBuildContext.viewer`.
 *
 * The rule itself is pinned in `payload-builder-node-deny-viewer.test.ts`; this
 * file pins only that the viewer ARRIVES. The field is optional and absent means
 * "a user", so a dropped argument compiles clean and would silently take every
 * admin's hidden node away at run time while their picker still offers it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockReserveCredits } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "text-to-audio",
    queueName: "video-generation",
    modelIdentifier: "elevenlabs-sfx",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
        update: vi.fn().mockReturnValue({ eq: eqFn }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))

vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: (data: Record<string, unknown>) => data,
  NODE_MAPPABLE_FIELDS: { "text-to-audio": ["prompt"] },
}))

// Who is an admin is lib/availability-viewer.ts's business (covered there). Here
// it only has to be ASKED with the right arguments and its answer handed on.
const mockViewerForNode = vi.hoisted(() =>
  vi.fn(async (_type: string, userId: string | null | undefined) => ({ admin: userId === "admin-1" })),
)
// `hidden` = node types the admin switch withholds from users; an admin keeps them.
const hidden = vi.hoisted(() => new Set<string>())
// The real one (lib/availability-viewer.ts, tested there) throws the coded error;
// this stand-in keeps that contract so the test can see it propagate.
const mockAssertNodeAvailable = vi.hoisted(() =>
  vi.fn(async (type: string, userId: string | null | undefined) => {
    if (hidden.has(type) && userId !== "admin-1") {
      throw Object.assign(new Error(`not available on this deployment: ${type}`), { code: "node_not_available" })
    }
  }),
)
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: mockViewerForNode,
  assertNodeAvailableForUser: mockAssertNodeAvailable,
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const ctx = (userId: string) => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId,
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

describe("node-executor hands the execution's availability viewer to buildPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hidden.clear()
  })

  async function viewerSeenFor(userId: string): Promise<unknown> {
    const node: SimpleNode = { id: "n1", type: "text-to-audio", data: { label: "SFX", prompt: "rain" } }
    // The poll never resolves in this harness; the enqueue is all we need.
    void executeNode(node, {}, [], [node], {}, ctx(userId)).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    const buildCtx = (mockBuildPayload.mock.calls[0] as unknown as unknown[])[4] as { viewer?: unknown }
    return buildCtx.viewer
  }

  it("asks about THIS node as THIS execution's user", async () => {
    await viewerSeenFor("admin-1")
    expect(mockViewerForNode).toHaveBeenCalledWith("text-to-audio", "admin-1")
  })

  it("an admin's execution builds as an admin", async () => {
    expect(await viewerSeenFor("admin-1")).toEqual({ admin: true })
  })

  it("a user's execution builds as a user — including a user running an admin's app", async () => {
    expect(await viewerSeenFor("user-1")).toEqual({ admin: false })
  })

  // The 3D authoring lane is sync-HTTP, but it composes its request body through
  // buildPayload (scene3d-http.ts) — a second call site with its own context object.
  it("the 3D authoring lane hands the viewer on as well", async () => {
    const node: SimpleNode = { id: "n3d", type: "generate-3d-scene", data: { label: "Scene", prompt: "a room" } }
    void executeNode(node, {}, [], [node], {}, ctx("admin-1")).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    const buildCtx = (mockBuildPayload.mock.calls[0] as unknown as unknown[])[4] as { viewer?: unknown }
    expect(mockViewerForNode).toHaveBeenCalledWith("generate-3d-scene", "admin-1")
    expect(buildCtx.viewer).toEqual({ admin: true })
  })
})

/**
 * ONE availability door for every lane. The lanes used to decide for themselves
 * and most decided nothing: a sync-HTTP node relied on its route's creditGuard,
 * which derives the node type from the route PATH and so never matched
 * `llm-chat` (/v1/llm-chat/generate) or the social posts (/v1/social/publish);
 * inline nodes (`combine-text`) were checked by nobody. `executeNode` now asks
 * once, as the execution's user, before any lane is chosen.
 */
describe("executeNode refuses a node hidden from the execution's user, whatever its lane", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hidden.clear()
  })

  const LANES = [
    ["worker-queued", "text-to-audio"],
    ["sync-HTTP on a path that is NOT the node type", "llm-chat"],
    ["inline", "combine-text"],
  ] as const

  it.each(LANES)("%s (%s): a user's run fails with the coded error before anything is created", async (_lane, type) => {
    hidden.add(type)
    const node: SimpleNode = { id: "n1", type, data: { label: "X", prompt: "p" } }
    await expect(executeNode(node, {}, [], [node], {}, ctx("user-1"))).rejects.toMatchObject({
      code: "node_not_available",
      message: expect.stringContaining(type),
    })
    // …with the node's DATA: a hosted capability (Web Scrape's source) is read from it.
    expect(mockAssertNodeAvailable).toHaveBeenCalledWith(type, "user-1", node.data)
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("an admin's run of the same hidden node is not refused", async () => {
    hidden.add("text-to-audio")
    const node: SimpleNode = { id: "n1", type: "text-to-audio", data: { label: "SFX", prompt: "rain" } }
    void executeNode(node, {}, [], [node], {}, ctx("admin-1")).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    expect(mockAssertNodeAvailable).toHaveBeenCalledWith("text-to-audio", "admin-1", node.data)
  })
})
