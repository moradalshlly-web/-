/**
 * The CLI's standalone-binary install commands have to reach a binary.
 *
 * They did not: every `releases/latest/download/nodaro-<platform>` link answered
 * 404, because this repository's "latest" release is the APP's (`vX.Y.Z`) and the
 * CLI binaries are attached to `cli-vX.Y.Z` releases. A version written into the
 * page would work until the next CLI release and then go stale, so the commands
 * resolve the newest `cli-v*` tag when they are RUN.
 *
 * Two ways the pages can rot again, both held here:
 *  - someone "simplifies" the commands back to `releases/latest/download/…`;
 *  - the release workflow's platform matrix changes and the pages keep naming
 *    the old assets.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8").replace(/\r\n/g, "\n")

const INSTALL_PAGES = ["docs/cli.md", "packages/cli/README.md"] as const

/** Every `asset:` the release workflow builds, e.g. `nodaro-linux-x64`. */
function releasedAssets(): string[] {
  return Array.from(read(".github/workflows/cli-release.yml").matchAll(/^\s*asset:\s+(nodaro-\S+)\s*$/gm), (m) => m[1])
}

function markdownFilesUnder(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : markdownFilesUnder(path)
    // A changelog is history: it may quote the link this guard exists to keep out.
    return entry.name.endsWith(".md") && entry.name !== "CHANGELOG.md" ? [path] : []
  })
}

describe("the release workflow still builds what the pages name", () => {
  it("reads a non-empty platform matrix", () => {
    expect(releasedAssets().length).toBeGreaterThanOrEqual(5)
  })
})

describe.each(INSTALL_PAGES)("%s — standalone binary install", (page) => {
  const doc = read(page)

  it("resolves the newest cli-v* tag at run time instead of naming a version", () => {
    expect(doc).toContain("/git/matching-refs/tags/cli-v?per_page=100")
    // …and sorts by VERSION: the refs come back in string order, where 1.9.0 > 1.20.0.
    expect(doc).toContain("sort -t. -k1,1n -k2,2n -k3,3n")
    expect(doc).toContain("[version]$_")
    expect(doc).not.toMatch(/releases\/download\/cli-v\d/)
  })

  it("downloads from the resolved cli-v release, failing loudly on an HTTP error", () => {
    expect(doc).toContain("releases/download/cli-v$NODARO_CLI_VERSION/nodaro-$NODARO_CLI_PLATFORM")
    expect(doc).toContain("releases/download/cli-v$v/nodaro-windows-x64.exe")
    // Without -f, curl saves GitHub's "Not Found" page as /usr/local/bin/nodaro and chmod +x's it.
    expect(doc).toMatch(/curl -fL "https:\/\/github\.com\/nodaroai\/app\.nodaro\.ai\/releases\/download\//)
  })

  it("names every platform the release workflow builds, and no other", () => {
    const assets = releasedAssets()
    for (const asset of assets) {
      const named = asset.endsWith(".exe") ? asset : asset.replace(/^nodaro-/, "")
      expect(doc, `${page} does not mention ${named}`).toContain(named)
    }
    const platformsInPage = Array.from(doc.matchAll(/\b(?:darwin|linux|windows)-(?:arm64|x64)\b/g), (m) => m[0])
    const built = new Set(assets.map((asset) => asset.replace(/^nodaro-/, "").replace(/\.exe$/, "")))
    expect([...new Set(platformsInPage)].filter((platform) => !built.has(platform))).toEqual([])
  })
})

describe("no page links a CLI binary through releases/latest", () => {
  const pages = [...markdownFilesUnder("docs"), ...markdownFilesUnder("packages/cli")]

  it("scans the public docs and the package's own pages", () => {
    expect(pages).toContain("docs/cli.md")
    expect(pages).toContain("packages/cli/README.md")
  })

  it("finds no `releases/latest/download/nodaro-` anywhere", () => {
    const offenders = pages.filter((page) => /releases\/latest\/download\/nodaro-/.test(read(page)))
    expect(offenders).toEqual([])
  })
})
