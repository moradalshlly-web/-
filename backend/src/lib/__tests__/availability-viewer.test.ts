import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"

const checkIsAdmin = vi.fn<(userId: string) => Promise<boolean>>()
vi.mock("../admin-check.js", () => ({ checkIsAdmin: (userId: string) => checkIsAdmin(userId) }))
// The real config, with the one edition fact this module reads under test control.
const edition = vi.hoisted(() => ({ hasAdmin: true }))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasAdmin: () => edition.hasAdmin,
}))

import {
  viewerForUser,
  viewerForNode,
  isNodeDeniedForUser,
  findDeniedNodeTypesForUser,
  assertNodeAvailableForUser,
} from "../availability-viewer.js"
import { ADMIN_VIEWER, USER_VIEWER } from "../surface-deny.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
  GATEABLE_NODE_TYPES,
} from "../availability-override.js"

beforeAll(() => __availabilityUniverseReadyForTests())

/** The override the production deployment carries: everything on except the two scrapers. */
function hideScrapersFromUsers(): void {
  const off = new Set(["instagram-scrape", "meta-ads-scrape"])
  __resetAvailabilityOverridesForTests({ nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => !off.has(t))) })
}

beforeEach(() => {
  edition.hasAdmin = true
  checkIsAdmin.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  __resetAvailabilityOverridesForTests()
  vi.restoreAllMocks()
})

describe("viewerForUser — one definition of admin, fail-closed", () => {
  it("no user id is a user, without asking the database", async () => {
    expect(await viewerForUser(undefined)).toBe(USER_VIEWER)
    expect(await viewerForUser(null)).toBe(USER_VIEWER)
    expect(await viewerForUser("")).toBe(USER_VIEWER)
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  it("maps the shared admin check onto the viewer", async () => {
    checkIsAdmin.mockResolvedValueOnce(true)
    expect(await viewerForUser("admin-1")).toBe(ADMIN_VIEWER)
    checkIsAdmin.mockResolvedValueOnce(false)
    expect(await viewerForUser("user-1")).toBe(USER_VIEWER)
  })

  it("an edition with no admin panel has no admins — the role is not even looked up", async () => {
    edition.hasAdmin = false
    checkIsAdmin.mockResolvedValue(true)
    expect(await viewerForUser("admin-1")).toBe(USER_VIEWER)
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  it("a failed admin lookup is a USER — an outage never widens availability", async () => {
    checkIsAdmin.mockRejectedValueOnce(new Error("Admin check failed: db down"))
    expect(await viewerForUser("admin-1")).toBe(USER_VIEWER)
  })
})

describe("per-user node checks — no admin lookup on the common path", () => {
  it("an available node never touches the admin check", async () => {
    hideScrapersFromUsers()
    expect(await isNodeDeniedForUser("generate-image", "user-1")).toBe(false)
    expect(await viewerForNode("generate-image", "user-1")).toBe(USER_VIEWER)
    expect(await findDeniedNodeTypesForUser([{ type: "generate-image" }, { type: "text-prompt" }], "user-1")).toEqual([])
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  it("a hidden node is refused for a user and kept for an admin", async () => {
    hideScrapersFromUsers()
    checkIsAdmin.mockImplementation(async (id) => id === "admin-1")

    expect(await isNodeDeniedForUser("instagram-scrape", "user-1")).toBe(true)
    expect(await isNodeDeniedForUser("instagram-scrape", "admin-1")).toBe(false)
    expect(await isNodeDeniedForUser("instagram-scrape", undefined)).toBe(true)

    const nodes = [{ type: "instagram-scrape" }, { type: "generate-image" }, { type: "meta-ads-scrape" }]
    expect(await findDeniedNodeTypesForUser(nodes, "user-1")).toEqual(["instagram-scrape", "meta-ads-scrape"])
    expect(await findDeniedNodeTypesForUser(nodes, "admin-1")).toEqual([])

    expect(await viewerForNode("instagram-scrape", "admin-1")).toBe(ADMIN_VIEWER)
    expect(await viewerForNode("instagram-scrape", "user-1")).toBe(USER_VIEWER)
  })

  it("a hidden node stays refused for an admin when the admin lookup fails", async () => {
    hideScrapersFromUsers()
    checkIsAdmin.mockRejectedValue(new Error("Admin check failed: db down"))
    expect(await isNodeDeniedForUser("instagram-scrape", "admin-1")).toBe(true)
    expect(await findDeniedNodeTypesForUser([{ type: "instagram-scrape" }], "admin-1")).toEqual(["instagram-scrape"])
  })
})

describe("assertNodeAvailableForUser — the orchestrator's one door", () => {
  it("throws the coded error for a user, naming the node, and resolves for an admin", async () => {
    hideScrapersFromUsers()
    checkIsAdmin.mockImplementation(async (id) => id === "admin-1")

    await expect(assertNodeAvailableForUser("instagram-scrape", "user-1")).rejects.toMatchObject({
      code: "node_not_available",
      message: expect.stringContaining("instagram-scrape"),
    })
    await expect(assertNodeAvailableForUser("instagram-scrape", "admin-1")).resolves.toBeUndefined()
  })

  it("resolves for an available node without asking who the user is", async () => {
    hideScrapersFromUsers()
    await expect(assertNodeAvailableForUser("generate-image", "user-1")).resolves.toBeUndefined()
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })
})
