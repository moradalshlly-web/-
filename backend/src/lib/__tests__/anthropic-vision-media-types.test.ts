/**
 * The gap this guards: the platform accepts image formats on upload that the
 * Anthropic API cannot read. `routes/upload.ts` allows `image/avif` and only
 * transcodes HEIC/HEIF, so an AVIF upload is stored as AVIF — and any lane
 * that hands it to Claude gets
 * `image.source.…: The file format is invalid or unsupported`, which fails the
 * WHOLE request, not just that block.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ANTHROPIC_IMAGE_MEDIA_TYPES,
  anthropicVisionAccepts,
  mediaTypeFromUrl,
} from "../anthropic-image.js"

describe("ANTHROPIC_IMAGE_MEDIA_TYPES", () => {
  it("is exactly the four formats the API documents", () => {
    expect([...ANTHROPIC_IMAGE_MEDIA_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
  })

  // If the upload allowlist ever loses `image/avif`, this test should be
  // revisited — but while it is there, the gap is real and must stay covered.
  it("the upload allowlist really does admit a format Claude cannot read", () => {
    const uploads = readFileSync(join(import.meta.dirname, "..", "..", "routes", "upload.ts"), "utf8")
    expect(uploads).toContain('"image/avif"')
    expect(ANTHROPIC_IMAGE_MEDIA_TYPES.has("image/avif")).toBe(false)
  })
})

describe("mediaTypeFromUrl", () => {
  it.each([
    ["https://cdn.example/a.png", "image/png"],
    ["https://cdn.example/a.JPG", "image/jpeg"],
    ["https://cdn.example/a.avif?sig=1#x", "image/avif"],
    ["https://cdn.example/a.heic", "image/heic"],
  ])("%s → %s", (url, expected) => {
    expect(mediaTypeFromUrl(url)).toBe(expected)
  })

  it("says nothing about a URL with no extension", () => {
    expect(mediaTypeFromUrl("https://cdn.example/generated/9f2c")).toBeUndefined()
  })
})

describe("anthropicVisionAccepts", () => {
  it("trusts the declared type when there is one", () => {
    expect(anthropicVisionAccepts("https://cdn.example/a.avif", "image/png")).toBe(true)
    expect(anthropicVisionAccepts("https://cdn.example/a.png", "image/avif")).toBe(false)
    expect(anthropicVisionAccepts("https://cdn.example/a.png", "image/jpeg; charset=binary")).toBe(true)
    // Not a registered media type, but real uploaders send it.
    expect(anthropicVisionAccepts("https://cdn.example/a.jpg", "image/jpg")).toBe(true)
  })

  it("falls back to the extension when the type is absent or empty", () => {
    expect(anthropicVisionAccepts("https://cdn.example/a.avif")).toBe(false)
    expect(anthropicVisionAccepts("https://cdn.example/a.heic", "")).toBe(false)
    expect(anthropicVisionAccepts("https://cdn.example/a.svg")).toBe(false)
    expect(anthropicVisionAccepts("https://cdn.example/a.webp")).toBe(true)
  })

  // Dropping what we cannot classify would lose images that work today —
  // job outputs are served from paths with no extension.
  it("keeps an image neither source can classify", () => {
    expect(anthropicVisionAccepts("https://cdn.example/generated/9f2c")).toBe(true)
    expect(anthropicVisionAccepts("https://cdn.example/a.bin", "application/octet-stream")).toBe(true)
  })
})
