import { test } from "node:test"
import assert from "node:assert/strict"
import { reconcileReview } from "../lib/character-motion-review-state.mjs"
const catalog = { revision: "new", entries: [{ id: "wave", hash: "new-entry", hashes: { label: "unchanged", promptHint: "new-prompt" } }] }
test("changed fields reset while unchanged decisions survive a revision change", () => {
  const result = reconcileReview({ version: 1, revision: "old", decisions: { wave: { entryHash: "old-entry", reviewed: true, deprecate: true, fields: { label: { hash: "unchanged", action: "edit", value: "Wave gently" }, promptHint: { hash: "old-prompt", action: "keep" } } } } }, catalog)
  assert.equal(result.decisions.wave.fields.label.value, "Wave gently")
  assert.equal(result.decisions.wave.fields.promptHint, undefined)
  assert.equal(result.decisions.wave.reviewed, false)
  assert.equal(result.decisions.wave.deprecate, false)
  assert.deepEqual(result.stale, ["wave.promptHint", "wave"])
})
test("same content survives; malformed data and unknown entry ids do not become decisions", () => {
  assert.throws(() => reconcileReview({ version: 2 }, catalog))
  const result = reconcileReview({ version: 1, decisions: { unknown: {}, wave: { entryHash: "new-entry", reviewed: true, fields: { label: { hash: "unchanged", action: "edit", value: {} } } } } }, catalog)
  assert.equal(result.decisions.unknown, undefined)
  assert.equal(result.decisions.wave.reviewed, true)
  assert.equal(result.decisions.wave.fields.label, undefined)
})
