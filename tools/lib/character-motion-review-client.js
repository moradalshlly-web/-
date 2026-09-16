const catalog = JSON.parse(document.getElementById("catalog").textContent)
const byId = new Map(catalog.entries.map(entry => [entry.id, entry]))
const storageKey = `nodaro-motion-review:${catalog.revision}`
let state = { version: 1, revision: catalog.revision, decisions: Object.create(null) }
let limit = 40
const $ = id => document.getElementById(id)
const node = (tag, text, parent) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; parent?.append(el); return el }
function notice(text) { $("notice").textContent = text }
try { const saved = localStorage.getItem(storageKey); if (saved) state = reconcileReview(JSON.parse(saved), catalog) } catch { notice("Browser storage is unavailable or the saved review is invalid. Export before closing.") }
function decision(entry) { return state.decisions[entry.id] ??= { fields: Object.create(null), reviewed: false, deprecate: false, entryHash: entry.hash } }
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)) } catch { notice("Could not save in this browser. Export decisions now.") }
  counts()
}
function counts() {
  const values = Object.values(state.decisions)
  const reviewed = values.filter(d => d.reviewed).length
  const edited = values.filter(d => Object.values(d.fields).some(f => f.action === "edit")).length
  const deprecated = values.filter(d => d.deprecate).length
  $("counts").textContent = `${catalog.entries.length - reviewed} unmarked · ${reviewed} reviewed · ${edited} edited · ${deprecated} proposed deprecations`
}
for (const [id, label] of Object.entries(catalog.categories)) { const opt = node("option", label, $("category")); opt.value = id }
$("revision").textContent = `Source commit and content fingerprint: ${catalog.revision}`
for (const sequence of catalog.sequences) {
  const section = node("details", undefined, $("sequences")); node("summary", sequence.label, section)
  node("pre", sequence.full, section); node("pre", sequence.compact, section)
  for (const item of sequence.diagnostics) node("p", item.message, section)
}
function render() {
  const q = $("search").value.toLowerCase().trim(), category = $("category").value, filter = $("filter").value
  const entries = catalog.entries.filter(entry => {
    const d = state.decisions[entry.id]
    return (!category || category === entry.category) && (!q || [entry.id, entry.label, entry.description, ...(entry.aliases ?? [])].join(" ").toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "reviewed" ? d?.reviewed : filter === "unmarked" ? !d?.reviewed : filter === "deprecated" ? d?.deprecate : Object.values(d?.fields ?? {}).some(f => f.action === "edit")))
  })
  $("entries").replaceChildren()
  for (const entry of entries.slice(0, limit)) {
    const article = node("article", undefined, $("entries")); node("h2", entry.label, article); node("small", entry.id, article)
    const d = decision(entry)
    const reviewed = node("button", d.reviewed ? "Reviewed ✓" : "Mark reviewed", article); reviewed.setAttribute("aria-pressed", String(d.reviewed))
    reviewed.onclick = () => { d.reviewed = !d.reviewed; persist(); render() }
    const deprecate = node("button", d.deprecate ? "Deprecation proposed ✓" : "Propose deprecation", article); deprecate.setAttribute("aria-pressed", String(d.deprecate))
    deprecate.onclick = () => { d.deprecate = !d.deprecate; persist(); render() }
    node("small", "Deprecation hides a new choice while keeping saved workflows resolvable.", article)
    for (const field of catalog.fields) {
      const group = node("div", undefined, article); group.className = "field"
      node("label", field, group)
      const value = entry[field] ?? null
      node("pre", typeof value === "string" ? value : JSON.stringify(value), group)
      const choice = d.fields[field]
      const keep = node("button", "Keep", group); keep.setAttribute("aria-label", `Keep ${field} for ${entry.label}`); keep.setAttribute("aria-pressed", String(choice?.action === "keep"))
      keep.onclick = () => { d.fields[field] = { action: "keep", hash: entry.hashes[field] }; d.reviewed = false; persist(); render() }
      const edit = node("button", "Edit", group); edit.setAttribute("aria-label", `Edit ${field} for ${entry.label}`); edit.setAttribute("aria-pressed", String(choice?.action === "edit"))
      edit.onclick = () => { d.fields[field] = { action: "edit", hash: entry.hashes[field], value: typeof value === "string" ? value : JSON.stringify(value) }; d.reviewed = false; persist(); render() }
      if (choice?.action === "edit") {
        const input = node("textarea", undefined, group); input.value = choice.value; input.setAttribute("aria-label", `Proposed ${field} for ${entry.label}`)
        input.oninput = () => { choice.value = input.value; d.reviewed = false; reviewed.textContent = "Mark reviewed"; reviewed.setAttribute("aria-pressed", "false"); persist() }
      }
    }
    node("h3", "Actual composer output from base fields", article)
    node("label", "Full", article); node("pre", entry.full, article)
    node("label", "Compact", article); node("pre", entry.compact, article)
    for (const item of entry.diagnostics) node("p", item.message, article)
  }
  $("more").hidden = entries.length <= limit
  counts()
}
for (const id of ["search", "category", "filter"]) $(id).addEventListener("input", () => { limit = 40; render() })
$("more").onclick = () => { limit += 40; render() }
$("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }))
  const a = node("a"); a.href = url; a.download = `character-motion-review-${catalog.commit.slice(0, 8)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
$("import").onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return
  try {
    const imported = JSON.parse(await file.text()); state = reconcileReview(imported, catalog); persist(); render()
    notice(`${imported.revision === catalog.revision ? "Imported review." : `Reviewed against ${imported.revision}; current revision is ${catalog.revision}.`} ${state.stale.length} changed decisions reset to unmarked.${state.stale.length ? ` Re-review: ${state.stale.join(", ")}` : ""}`)
  } catch (error) { notice(`Import failed: ${error.message}`) }
  event.target.value = ""
}
render()
