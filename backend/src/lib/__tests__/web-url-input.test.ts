import { describe, it, expect } from "vitest"
import { normalizeWebUrlInput } from "../web-url-input.js"

describe("normalizeWebUrlInput", () => {
  it.each([
    ["pletor.ai", "https://pletor.ai"],
    ["www.pletor.ai", "https://www.pletor.ai"],
    ["www.pletor.ai/products?x=1#top", "https://www.pletor.ai/products?x=1#top"],
    ["  pletor.ai/blog  ", "https://pletor.ai/blog"],
    ["//cdn.pletor.ai/a.png", "https://cdn.pletor.ai/a.png"],
    ["instagram.com/nike", "https://instagram.com/nike"],
  ])("adds the missing scheme: %s → %s", (input, expected) => {
    expect(normalizeWebUrlInput(input)).toBe(expected)
  })

  it.each([
    "https://pletor.ai",
    "http://www.pletor.ai/products",
    "HTTPS://PLETOR.AI",
    "ftp://files.example.com/x",
  ])("keeps a value that already carries a scheme as typed: %s", (input) => {
    expect(normalizeWebUrlInput(input)).toBe(input)
  })

  it("leaves non-strings and the empty string to the schema", () => {
    expect(normalizeWebUrlInput(undefined)).toBeUndefined()
    expect(normalizeWebUrlInput(42)).toBe(42)
    expect(normalizeWebUrlInput("   ")).toBe("")
  })
})
