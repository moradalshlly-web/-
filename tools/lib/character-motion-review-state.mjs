/** Decisions are data only. Changed fields lose approval; unchanged fields survive. */
export function reconcileReview(document, catalog) {
  if (!document || document.version !== 1 || !document.decisions || typeof document.decisions !== "object" || Array.isArray(document.decisions)) throw new Error("Unsupported review file")
  const decisions = Object.create(null)
  const stale = []
  for (const entry of catalog.entries) {
    const previous = document.decisions[entry.id]
    if (!previous || typeof previous !== "object") continue
    const fields = Object.create(null)
    for (const [field, hash] of Object.entries(entry.hashes)) {
      const choice = previous.fields?.[field]
      if (!choice || !["keep", "edit"].includes(choice.action)) continue
      if (choice.hash !== hash) { stale.push(`${entry.id}.${field}`); continue }
      if (choice.action === "edit" && typeof choice.value !== "string") continue
      fields[field] = { action: choice.action, hash, ...(choice.action === "edit" ? { value: choice.value } : {}) }
    }
    const sameEntry = previous.entryHash === entry.hash
    decisions[entry.id] = { fields, reviewed: sameEntry && previous.reviewed === true, deprecate: sameEntry && previous.deprecate === true, entryHash: entry.hash }
    if (!sameEntry && (previous.reviewed || previous.deprecate)) stale.push(entry.id)
  }
  return { version: 1, revision: catalog.revision, decisions, stale, importedRevision: document.revision }
}
