import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const state = vi.hoisted(() => ({ denied: new Set<string>(), admins: new Set<string>(), capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn(), proRender: vi.fn(), quoteProRender: vi.fn() }))
vi.mock("@/lib/config.js", () => ({ config: { SCENE3D_ADVANCED_ENABLED: true, SCENE3D_LOCAL_ENABLED: false }, hasCredits: () => true }))
vi.mock("@/lib/private-plugins/engine-registry.js", () => ({ getPluginEngines: () => ({ scene3d: state }) }))
// `denied` = hidden from USERS by the admin switch; an admin keeps those.
vi.mock("@/lib/surface-deny.js", () => ({
  isNodeDenied: (type: string, viewer: { admin: boolean }) => state.denied.has(type) && !viewer.admin,
  deniedNodeRejectionMessage: (types: string[]) => `Unavailable: ${types.join(", ")}`,
}))
vi.mock("@/lib/availability-viewer.js", () => ({
  isNodeDeniedForUser: async (type: string, userId?: string) => state.denied.has(type) && !state.admins.has(userId ?? ""),
}))
vi.mock("@/lib/http-errors.js", () => ({
  sendInternalError: vi.fn(),
  __flushHttpErrorTelemetry: vi.fn(),
  __resetHttpErrorTelemetry: vi.fn(),
}))

import { dispatchAdvancedScene3D, dispatchPro3DRender, dispatchPro3DRenderQuote, scene3DProAvailable } from "../scene3d-engine.js"

beforeEach(() => {
  vi.clearAllMocks()
  state.denied.clear()
  state.admins.clear()
  state.capabilities.mockResolvedValue({ engines: ["blender-cloud"] })
})

const request = { userId: "user", body: { engine: "blender-cloud" } } as FastifyRequest
function reply() {
  const value = { status: vi.fn(), send: vi.fn(), sent: false }
  value.status.mockReturnValue(value)
  return value
}

describe("Advanced scene deployment policy", () => {
  it.each(["generate", "edit"] as const)("refuses denied %s before engine admission", async (operation) => {
    state.denied.add(`${operation}-3d-scene`)
    const response = reply()
    await dispatchAdvancedScene3D(operation, request, response as unknown as FastifyReply)
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.send).toHaveBeenCalledWith({ error: { code: "node_not_available", message: `Unavailable: ${operation}-3d-scene` } })
    expect(state.capabilities).not.toHaveBeenCalled()
    expect(state[operation]).not.toHaveBeenCalled()
  })

  it("does not deny a permitted operation because the other node is disabled", async () => {
    state.denied.add("generate-3d-scene")
    const response = reply()
    await dispatchAdvancedScene3D("edit", request, response as unknown as FastifyReply)
    expect(state.edit).toHaveBeenCalledWith(request, response)
    expect(response.status).not.toHaveBeenCalledWith(403)
  })

  it("hides denied Pro and refuses both direct dispatch methods", async () => {
    expect(scene3DProAvailable({ admin: false })).toBe(true)
    state.denied.add("pro-3d-render")
    expect(scene3DProAvailable({ admin: false })).toBe(false)
    for (const dispatch of [dispatchPro3DRender, dispatchPro3DRenderQuote]) {
      const response = reply()
      await dispatch(request, response as unknown as FastifyReply)
      expect(response.status).toHaveBeenCalledWith(403)
    }
    expect(state.proRender).not.toHaveBeenCalled()
    expect(state.quoteProRender).not.toHaveBeenCalled()
  })

  it("an admin keeps what the admin switch hides from users — Advanced and Pro alike", async () => {
    state.denied.add("generate-3d-scene")
    state.denied.add("pro-3d-render")
    state.admins.add("admin")
    const asAdmin = { userId: "admin", body: { engine: "blender-cloud" } } as FastifyRequest

    expect(scene3DProAvailable({ admin: true })).toBe(true)
    expect(scene3DProAvailable({ admin: false })).toBe(false)

    const advanced = reply()
    await dispatchAdvancedScene3D("generate", asAdmin, advanced as unknown as FastifyReply)
    expect(advanced.status).not.toHaveBeenCalledWith(403)
    expect(state.generate).toHaveBeenCalledWith(asAdmin, advanced)

    const pro = reply()
    await dispatchPro3DRender(asAdmin, pro as unknown as FastifyReply)
    expect(pro.status).not.toHaveBeenCalledWith(403)
    expect(state.proRender).toHaveBeenCalledWith(asAdmin, pro)

    // The same request from a user is still refused.
    const refused = reply()
    await dispatchPro3DRender(request, refused as unknown as FastifyReply)
    expect(refused.status).toHaveBeenCalledWith(403)
  })
})
