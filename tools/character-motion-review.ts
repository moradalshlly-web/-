/** Generate a portable, offline catalog review from the canonical composer.
 * Usage: npx tsx tools/character-motion-review.ts /tmp/character-motion-review.html */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { CHARACTER_MOTIONS, CHARACTER_MOTION_CATEGORY_LABELS, composeCharacterMotionHintFromConnections as compose } from "../packages/prompts/src/character-motion.js"
import { getCharacterMotionDiagnostics } from "../packages/prompts/src/character-motion-diagnostics.js"
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const fields = ["label", "description", "term", "promptHint", "category", "adultOnly", "twoPerson", "counterpart", "aliases", "requires", "startPose", "endPose", "endVisibility", "handsAfter", "needsFreeHands", "kind", "fixedPace", "deprecated", "replacementId"] as const
const entries = CHARACTER_MOTIONS.filter(entry => entry.promptHint).map(entry => {
  const rendered = {
    ...entry,
    full: compose(entry.id, ["{Target}"], ["{Partner}"], undefined, "full"),
    compact: compose(entry.id, ["{Target}"], ["{Partner}"], undefined, "compact"),
    diagnostics: getCharacterMotionDiagnostics(entry.id),
  }
  // A composer/diagnostic change invalidates whole-entry approval even when
  // its source fields are unchanged. Per-field decisions can still survive.
  return { ...rendered, hash: hash(rendered), hashes: Object.fromEntries(fields.map(field => [field, hash(entry[field] ?? null)])) }
})
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["status", "--porcelain", "--", "packages/prompts", "tools/character-motion-review.ts", "tools/lib/character-motion-review-client.js", "tools/lib/character-motion-review-state.mjs"], { encoding: "utf8" }).trim().length > 0
const catalog = { revision: `${commit}${dirty ? "+working-tree" : ""}:${hash(entries)}`, commit, fields, entries, categories: CHARACTER_MOTION_CATEGORY_LABELS,
  sequences: Object.entries(CHARACTER_MOTION_CATEGORY_LABELS).map(([category, label]) => {
    const ids = entries.filter(entry => entry.category === category && !entry.deprecated).slice(0, 2).map(entry => entry.id)
    return { label, ids, full: compose(ids, ["{Target}"], ["{Partner}"]), compact: compose(ids, ["{Target}"], ["{Partner}"], undefined, "compact"), diagnostics: getCharacterMotionDiagnostics(ids) }
  }),
}
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")
const output = process.argv[2]
if (!output) throw new Error("Supply an output HTML path outside tracked app documentation")
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Character Motion catalog review</title>
<style>body{font:15px system-ui;margin:0;color:#202124;background:#fafafa}header{position:sticky;top:0;background:white;border-bottom:1px solid #ccc;padding:16px;z-index:1}main{max-width:1050px;margin:auto;padding:16px}h1{font-size:22px;margin:0}article{background:white;border:1px solid #ddd;border-radius:10px;padding:18px;margin:18px 0}label{display:block;margin:12px 0 4px;font-weight:600}textarea{box-sizing:border-box;width:100%;min-height:70px;font:inherit}button,input,select{font:inherit;padding:7px;margin:4px;border:1px solid #aaa;border-radius:5px}button{cursor:pointer}button[aria-pressed=true]{background:#d9ecff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px;background:#f3f4f6;padding:10px}small{display:block;overflow-wrap:anywhere}#notice{color:#8a3c00}nav{display:flex;flex-wrap:wrap;align-items:center}.field{border-top:1px solid #eee;padding:4px 0}.muted{color:#555}@media(max-width:600px){header{position:static}main{padding:8px}article{padding:12px}input,select{max-width:90%}}</style>
<header><h1>Character Motion catalog review</h1><p>Base catalog fragments and actual composer output. These are not the final generation prompt.</p><small>Decisions are stored in this browser only. Export to keep them. No network calls or generation.</small><nav><input id="search" aria-label="Search catalog" placeholder="Search title, id, or alias"><select id="category" aria-label="Category"><option value="">All categories</option></select><select id="filter" aria-label="Review status"><option value="all">All entries</option><option value="unmarked">Unmarked</option><option value="reviewed">Reviewed</option><option value="edited">Edited</option><option value="deprecated">Deprecated</option></select><button id="export">Export decisions</button><label>Import decisions <input id="import" type="file" accept="application/json"></label></nav><div id="counts" role="status"></div><div id="notice" role="status"></div><small id="revision"></small></header>
<main><details><summary>Composition examples and review scope</summary><p>Target and Partner are example names. Full and Compact previews below use the unedited catalog, with Auto timing and no pre/post text. Editing a field records a proposal; it does not alter these previews or any deployment. Connected references, minor-age filtering, curated packs, timing, and downstream nodes can change the resulting prompt. Motion text supplies no audio synchronization or reference media. Model output remains unverified until tested.</p><div id="sequences"></div></details><div id="entries"></div><button id="more">Show next 40</button></main>
<script id="catalog" type="application/json">${JSON.stringify(catalog).replace(/</g, "\\u003c")}</script><script type="module">${read("./lib/character-motion-review-state.mjs")}\n${read("./lib/character-motion-review-client.js")}</script></html>`
writeFileSync(output, html)
process.stdout.write(`${output}\n${entries.length} entries; revision ${catalog.revision}\n`)
