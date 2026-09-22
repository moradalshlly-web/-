import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The plain-text subtitle is ONE drawtext pass. Its argv reaches ffmpeg without
 * a shell, so the line break a caller writes as `\n` must arrive as a real
 * newline: the two-character `\n` the old escaping substituted is un-escaped by
 * the filtergraph parser to a bare `n`, and "SALE ENDS FRIDAY\nFree shipping"
 * burned in as one glued line ("FRIDAYnFree"). Every surface documents `\n` as
 * a forced break on `subtitle`, on both renderers.
 */
const runFfmpeg = vi.fn<(args: string[]) => Promise<void>>(async () => {})
vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: vi.fn(async () => {}),
  runFfmpeg: (args: string[]) => runFfmpeg(args),
  createWorkDir: vi.fn(async () => "/tmp/add-captions-test"),
  cleanupWorkDir: vi.fn(async () => {}),
}))

const { addCaptions } = await import("../add-captions.js")

function drawtextArg(): string {
  const args = runFfmpeg.mock.calls[0]?.[0] ?? []
  return args[args.indexOf("-vf") + 1] ?? ""
}

describe("addCaptions — drawtext text escaping", () => {
  beforeEach(() => runFfmpeg.mockClear())

  it("passes a caller's newline through as a REAL line break, never as the two characters \\n", async () => {
    await addCaptions({ videoUrl: "https://x/v.mp4", text: "SALE ENDS FRIDAY\nFree shipping on everything" })
    const vf = drawtextArg()
    expect(vf).toContain("text='SALE ENDS FRIDAY\nFree shipping on everything'")
    expect(vf).not.toContain("FRIDAY\\nFree")
  })

  it("centres every line of a multi-line block (text_align=C), like the Remotion static block", async () => {
    await addCaptions({ videoUrl: "https://x/v.mp4", text: "one\ntwo" })
    expect(drawtextArg()).toContain(":text_align=C")
  })

  it("still escapes the filtergraph-sensitive characters (colon, quote, backslash)", async () => {
    await addCaptions({ videoUrl: "https://x/v.mp4", text: "Hello: it's a \\ test" })
    const vf = drawtextArg()
    expect(vf).toContain("Hello\\: it’s a \\\\\\\\ test")
  })
})
