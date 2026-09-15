/**
 * The template canvas is read-only and its nodes are inert, so a prompt that
 * does not fit its node was simply unreadable — a tutorial that hides its own
 * prompts (2026-09-15). A click on a node now opens an inspector with
 * every long text field in full. These are the pure parts: which fields a node
 * exposes, in which order, and which node sits under a click.
 */
import { describe, expect, it } from "vitest"
import { inspectorFields, inspectorSettings, nodeAtPoint } from "../node-inspector-fields"

describe("inspectorFields", () => {
  it("lists an image node's prompt first, then the negative prompt, and skips empty fields", () => {
    const fields = inspectorFields({
      id: "shot-1",
      type: "generate-image",
      data: { label: "Shot 1", prompt: "A {Shoot concept || studio} portrait.", negativePrompt: "", style: "" },
    })
    expect(fields).toEqual([{ key: "prompt", label: "Prompt", value: "A {Shoot concept || studio} portrait." }])
  })

  it("shows a text node's system and user prompts and its generated result", () => {
    const fields = inspectorFields({
      id: "concept",
      type: "llm-chat",
      data: { label: "Shoot concept", systemPrompt: "You are an art director.", userInput: "Write it.", generatedText: "The model wears pink." },
    })
    expect(fields.map((f) => f.key)).toEqual(["systemPrompt", "userInput", "generatedText"])
    expect(fields[2]).toEqual({ key: "generatedText", label: "Result", value: "The model wears pink." })
  })

  it("shows a sticky note's body and a text-prompt node's text", () => {
    expect(inspectorFields({ id: "n", type: "sticky-note", data: { title: "Step 1", text: "One clean photo." } })).toEqual([
      { key: "text", label: "Note", value: "One clean photo." },
    ])
    expect(inspectorFields({ id: "t", type: "text-prompt", data: { label: "Styling notes", text: "Worn closed." } })).toEqual([
      { key: "text", label: "Text", value: "Worn closed." },
    ])
  })

  it("never exposes a result URL, a job id or a non-string as a field", () => {
    const fields = inspectorFields({
      id: "x",
      type: "generate-image",
      data: { prompt: "p", generatedImageUrl: "https://cdn/x.png", kieTaskId: "abc", generatedResults: [{ url: "u" }], activeResultIndex: 0 },
    })
    expect(fields.map((f) => f.key)).toEqual(["prompt"])
  })
})

describe("inspectorSettings", () => {
  it("collects the short model settings a viewer would want to copy", () => {
    const settings = inspectorSettings({
      id: "s",
      type: "generate-image",
      data: { provider: "gpt-image-2", resolution: "1K", aspectRatio: "3:4", prompt: "long text", fieldMappings: {}, presentationOutput: true },
    })
    expect(settings).toEqual([
      { label: "Model", value: "gpt-image-2" },
      { label: "Resolution", value: "1K" },
      { label: "Aspect ratio", value: "3:4" },
    ])
  })

  it("names a picker's chosen tiles", () => {
    const settings = inspectorSettings({
      id: "l",
      type: "lighting",
      data: { label: "Lighting", hintMode: "compact", lightingStyle: "on-camera-flash", lightingDirection: "front", presentationInput: true },
    })
    expect(settings).toEqual([
      { label: "lightingStyle", value: "on-camera-flash" },
      { label: "lightingDirection", value: "front" },
    ])
  })
})

describe("nodeAtPoint", () => {
  const rects = [
    { id: "group", x: 0, y: 0, width: 1000, height: 1000 },
    { id: "a", x: 100, y: 100, width: 200, height: 100 },
    { id: "b", x: 250, y: 150, width: 200, height: 100 },
  ]

  it("returns the topmost (last-drawn) node under the point", () => {
    expect(nodeAtPoint(rects, { x: 260, y: 160 })).toBe("b")
    expect(nodeAtPoint(rects, { x: 120, y: 120 })).toBe("a")
  })

  it("falls back to the enclosing group and to null outside everything", () => {
    expect(nodeAtPoint(rects, { x: 900, y: 900 })).toBe("group")
    expect(nodeAtPoint(rects, { x: 2000, y: 5 })).toBeNull()
  })

  it("skips nodes that have no size yet", () => {
    expect(nodeAtPoint([{ id: "unmeasured", x: 0, y: 0, width: 0, height: 0 }], { x: 0, y: 0 })).toBeNull()
  })
})
