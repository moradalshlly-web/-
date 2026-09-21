/**
 * The graph -> `workflow_triggers` projection. These are the invariants that
 * keep a Schedule Trigger node from being decorative again: a preset cron
 * lands under `cron` (never `interval`, which `shouldTriggerFire` reads first
 * and `parseIntervalToMs` can only parse as `<n><s|m|h|d>`), a re-save is a
 * no-op, a removed node takes its row, and rows a human created by hand are
 * never touched.
 */
import { describe, it, expect } from "vitest"

import {
  desiredTriggersFromGraph,
  isCronExpression,
  mergeTriggerConfig,
  normalizeScheduleConfig,
  planTriggerSync,
  type ExistingTrigger,
} from "../workflow-trigger-sync.js"

const scheduleNode = (id: string, data: Record<string, unknown>) => ({
  id,
  type: "schedule-trigger",
  data: { label: "Schedule Trigger", ...data },
})

describe("normalizeScheduleConfig", () => {
  it("routes an editor PRESET (a cron string stored under `interval`) to `cron`", () => {
    // The trap: shouldTriggerFire checks config.interval first, and
    // parseIntervalToMs("0 * * * *") is 0 -> the schedule would never fire.
    expect(normalizeScheduleConfig({ interval: "0 * * * *" })).toEqual({ cron: "0 * * * *" })
    expect(normalizeScheduleConfig({ interval: "*/15 * * * *" })).toEqual({ cron: "*/15 * * * *" })
  })

  it("keeps a REAL interval under `interval`", () => {
    expect(normalizeScheduleConfig({ interval: "30m" })).toEqual({ interval: "30m" })
    expect(normalizeScheduleConfig({ interval: "1d" })).toEqual({ interval: "1d" })
  })

  it("never emits both keys at once", () => {
    const config = normalizeScheduleConfig({ interval: "0 6 * * 0-4", cron: "5 5 * * *" })
    expect(Object.keys(config ?? {}).filter((k) => k === "cron" || k === "interval")).toHaveLength(1)
  })

  it("reads the custom cron the editor panel writes, under either field name", () => {
    expect(normalizeScheduleConfig({ interval: "custom", cron: "0 6 * * 0-4" }))
      .toEqual({ cron: "0 6 * * 0-4" })
    // `cronExpression` is the name the panel used while the node type, the node
    // card and the table all said `cron`.
    expect(normalizeScheduleConfig({ interval: "custom", cronExpression: "0 6 * * 0-4" }))
      .toEqual({ cron: "0 6 * * 0-4" })
  })

  it("carries timezone and a positive maxExecutions, and drops the rest", () => {
    expect(normalizeScheduleConfig({
      interval: "custom",
      cron: "0 6 * * 0-4",
      timezone: "Asia/Jerusalem",
      maxExecutions: 3,
    })).toEqual({ cron: "0 6 * * 0-4", timezone: "Asia/Jerusalem", maxExecutions: 3 })

    expect(normalizeScheduleConfig({ interval: "0 * * * *", timezone: "  ", maxExecutions: 0 }))
      .toEqual({ cron: "0 * * * *" })
  })

  it("returns null for a node that is not configured enough to run", () => {
    // A half-filled node must not quietly start firing.
    expect(normalizeScheduleConfig({})).toBeNull()
    expect(normalizeScheduleConfig({ interval: "custom" })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "custom", cron: "" })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "every day" })).toBeNull()
    expect(normalizeScheduleConfig({ cron: "0 6 * *" })).toBeNull()
  })
})

describe("isCronExpression", () => {
  it("accepts exactly five fields", () => {
    expect(isCronExpression("0 6 * * 0-4")).toBe(true)
    expect(isCronExpression("  0   6 * * *  ")).toBe(true)
    expect(isCronExpression("0 6 * *")).toBe(false)
    expect(isCronExpression("0 6 * * * *")).toBe(false)
    expect(isCronExpression("30m")).toBe(false)
  })
})

describe("desiredTriggersFromGraph", () => {
  it("picks up configured schedule nodes and every webhook node", () => {
    expect(desiredTriggersFromGraph([
      scheduleNode("s1", { interval: "0 6 * * 0-4", timezone: "Asia/Jerusalem" }),
      { id: "w1", type: "webhook-trigger", data: { label: "Webhook", params: [] } },
      { id: "g1", type: "generate-image", data: { prompt: "a cat" } },
      scheduleNode("s2", { interval: "custom" }),
    ])).toEqual([
      { nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4", timezone: "Asia/Jerusalem" } },
      { nodeId: "w1", type: "webhook", config: {} },
    ])
  })

  it("survives an empty, missing or malformed graph", () => {
    expect(desiredTriggersFromGraph(undefined)).toEqual([])
    expect(desiredTriggersFromGraph([])).toEqual([])
    expect(desiredTriggersFromGraph([{ type: "schedule-trigger" }])).toEqual([])
    expect(desiredTriggersFromGraph([{ id: "s1", type: "schedule-trigger", data: null }])).toEqual([])
  })
})

describe("mergeTriggerConfig", () => {
  it("preserves runtime state the cron writes back", () => {
    const merged = mergeTriggerConfig(
      { cron: "0 5 * * *", nodeId: "s1", executionCount: 12 },
      { cron: "0 6 * * 0-4" },
      "s1",
    )
    expect(merged).toEqual({ cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 12 })
  })

  it("drops a stale schedule key so it cannot shadow the new one", () => {
    // interval wins over cron in shouldTriggerFire, so a leftover `interval`
    // would silently keep an old schedule alive.
    const merged = mergeTriggerConfig(
      { interval: "30m", timezone: "UTC", nodeId: "s1", executionCount: 4 },
      { cron: "0 6 * * 0-4" },
      "s1",
    )
    expect(merged).toEqual({ cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 4 })
    expect(merged).not.toHaveProperty("interval")
    expect(merged).not.toHaveProperty("timezone")
  })
})

describe("planTriggerSync", () => {
  const owned = (id: string, nodeId: string, config: Record<string, unknown>, isActive = true): ExistingTrigger =>
    ({ id, type: "schedule", config: { ...config, nodeId }, is_active: isActive })

  it("creates a row for a new schedule node", () => {
    const plan = planTriggerSync(
      [{ nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4" } }],
      [],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it("is a no-op when nothing changed (every later save)", () => {
    const plan = planTriggerSync(
      [{ nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4" } }],
      [owned("t1", "s1", { cron: "0 6 * * 0-4" })],
    )
    expect(plan).toEqual({ create: [], update: [], remove: [] })
  })

  it("reactivates a paused row without losing its execution count", () => {
    const plan = planTriggerSync(
      [{ nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4" } }],
      [owned("t1", "s1", { cron: "0 6 * * 0-4", executionCount: 9 }, false)],
    )
    expect(plan.update).toEqual([
      { id: "t1", config: { cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 9 }, isActive: true },
    ])
  })

  it("removes the row when its node leaves the graph", () => {
    const plan = planTriggerSync([], [owned("t1", "s1", { cron: "0 6 * * 0-4" })])
    expect(plan.remove).toEqual(["t1"])
    expect(plan.create).toEqual([])
  })

  it("never touches a row created by hand (no nodeId)", () => {
    const byHand: ExistingTrigger = {
      id: "curl-1",
      type: "schedule",
      config: { cron: "0 3 * * *" },
      is_active: true,
    }
    expect(planTriggerSync([], [byHand])).toEqual({ create: [], update: [], remove: [] })

    // ...and it does not satisfy a graph node either: the node still gets its own row.
    const plan = planTriggerSync(
      [{ nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4" } }],
      [byHand],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.remove).toEqual([])
  })

  it("keys on type as well as node id", () => {
    const plan = planTriggerSync(
      [{ nodeId: "n1", type: "webhook", config: {} }],
      [owned("t1", "n1", { cron: "0 6 * * 0-4" })],
    )
    expect(plan.create).toEqual([{ nodeId: "n1", type: "webhook", config: {} }])
    expect(plan.remove).toEqual(["t1"])
  })

  it("sweeps duplicate owned rows for the same node", () => {
    const plan = planTriggerSync(
      [{ nodeId: "s1", type: "schedule", config: { cron: "0 6 * * 0-4" } }],
      [owned("t1", "s1", { cron: "0 6 * * 0-4" }), owned("t2", "s1", { cron: "0 6 * * 0-4" })],
    )
    expect(plan.remove).toEqual(["t2"])
    expect(plan.create).toEqual([])
  })
})
