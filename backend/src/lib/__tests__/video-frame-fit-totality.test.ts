/**
 * EVERY PATH THAT HANDS A START FRAME TO A VIDEO MODEL FITS IT FIRST.
 *
 * The fit is not a route concern — it happens at dispatch, and there is no
 * single chokepoint to put it in: the router covers KIE and Replicate, the
 * private-plugin toolkit calls the KIE provider directly (gvp, recast, studio),
 * and the LTX branch skips the router altogether. Three call sites, and the
 * failure mode when a fourth is added is silent: frames reach the provider at
 * whatever size the user uploaded, and Seedance 2.5 snaps one frame into the
 * clip again.
 *
 * So the rule is data here. A file that reaches an image-to-video provider must
 * either call `applyFrameFitAndDelivery` or be listed in EXEMPT with a reason.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..")

/** Ways backend code reaches an image-to-video model. */
const DISPATCH_MARKERS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /resolveModule<ImageToVideoProvider>/, what: "routes through the provider registry" },
  { re: /new KieVideoProvider\(\)\s*\.\s*imageToVideo/s, what: "calls the KIE video provider directly" },
  { re: /runLtxImageToVideo\s*\(/, what: "calls the LTX image-to-video runner" },
]

/**
 * Files that reach a provider but must NOT fit — each entry is a decision.
 */
const EXEMPT: Record<string, string> = {
  // The implementation of the LTX runner itself: it receives the frame urls its
  // CALLER (workers/handlers/video-ai.ts) already fitted.
  "providers/replicate/ltx-video.ts": "provider implementation — its caller fits the frames",
  // The registry entry that constructs the provider; it dispatches nothing.
  "providers/kie/index.ts": "registry wiring, no frame ever passes through it",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

describe("start/end frame fit covers every dispatch path", () => {
  it("finds the dispatch sites we know about", () => {
    const files = walk(SRC_DIR)
    const hits = files.filter((f) => {
      const src = readFileSync(f, "utf8")
      return DISPATCH_MARKERS.some((m) => m.re.test(src))
    }).map((f) => relative(SRC_DIR, f))
    // If this drops to zero the markers stopped matching and the guard below
    // would pass vacuously.
    expect(hits).toContain("providers/router.ts")
    expect(hits).toContain("lib/private-plugins/toolkit.ts")
    expect(hits).toContain("workers/handlers/video-ai.ts")
  })

  it("every dispatch site fits its frames (or is exempt with a reason)", () => {
    const offenders: string[] = []
    for (const file of walk(SRC_DIR)) {
      const src = readFileSync(file, "utf8")
      const marker = DISPATCH_MARKERS.find((m) => m.re.test(src))
      if (!marker) continue
      const rel = relative(SRC_DIR, file)
      if (rel in EXEMPT) continue
      if (src.includes("applyFrameFitAndDelivery")) continue
      offenders.push(
        `${rel} ${marker.what} without calling applyFrameFitAndDelivery — ` +
          `fit the frames (lib/video-frame-dispatch.ts) or add the file to EXEMPT with a reason`,
      )
    }
    expect(offenders).toEqual([])
  })
})
