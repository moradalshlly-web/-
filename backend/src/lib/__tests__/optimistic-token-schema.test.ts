import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { expectedUpdatedAtSchema } from "../optimistic-token-schema.js"

const ROUTES_DIR = join(__dirname, "..", "..", "routes")

describe("expectedUpdatedAtSchema", () => {
  it("accepts the timestamp exactly as the database hands it out", () => {
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T09:46:43.943444+00:00").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T09:46:43.943Z").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T12:46:43+03:00").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse(undefined).success).toBe(true)
  })

  it("still rejects a value that is not a datetime", () => {
    expect(expectedUpdatedAtSchema.safeParse("yesterday").success).toBe(false)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16").success).toBe(false)
    expect(expectedUpdatedAtSchema.safeParse(1758000000).success).toBe(false)
  })

  it("no route validates the token with the offset-blind bare form", () => {
    const offenders = readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /expectedUpdatedAt:\s*z\.string\(\)\.datetime\(\)/.test(readFileSync(join(ROUTES_DIR, f), "utf8")))
    expect(offenders, "use expectedUpdatedAtSchema from lib/optimistic-token-schema.ts").toEqual([])
  })
})
