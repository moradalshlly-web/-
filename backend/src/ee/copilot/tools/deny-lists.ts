/**
 * What the model may NOT author through `edit_workflow`.
 *
 * Security boundary, not a UX preference: a prompt injected through node data,
 * an entity description or a provider error string could otherwise add (or
 * re-point) a node that ships the user's data out of the platform and then
 * propose a run. The model builds media pipelines; egress, publishing and
 * fetching from a named destination are the user's to configure by hand.
 *
 * TWO layers, because the first one alone was not enough (review of PR 2):
 *   1. `DENIED_NODE_TYPES` — a node whose executor sends to, or fetches from,
 *      a destination named in its own data. Guarded by
 *      `__tests__/deny-lists.test.ts`, which DERIVES the set from the
 *      orchestrator's executor so a new outbound node cannot ship uncovered.
 *   2. `isLockedField` — a destination-shaped field on ANY node, matched by
 *      pattern (every `*Url`/`*Urls` key plus the named destinations), checked
 *      RECURSIVELY. A nested `data.probedVideo.url` is a destination too.
 */

// The vocabulary itself — which node types are outbound, which keys name a
// destination — lives in core (`lib/outbound-node-lock.ts`) because the
// run-request override lock (`lib/input-override-lock.ts`, issue #1555) shares
// it and core may not import `ee/`. Re-exported here so the copilot's callers
// and the derivation test keep one import. The one copilot-only exception to
// the field lock is `isUserProvidedLink` below.
import {
  DENIED_NODE_TYPES,
  SOCIAL_PUBLISHER_TYPES,
  isLockedField,
  isPlainObject,
} from "../../../lib/outbound-node-lock.js"

export { DENIED_NODE_TYPES, SOCIAL_PUBLISHER_TYPES, isLockedField }

/**
 * The ONE exception to the field lock: a link the USER themselves pasted into
 * the chat (harvested by `extractUserLinks` from user-authored prose only) may
 * be copied — byte for byte — into a genuine `*Url` field. The lock defends
 * against model-CRAFTED destinations (`https://evil.com/?q=<secrets>` is an
 * exfiltration channel); a verbatim copy of the user's own link carries zero
 * crafting freedom, so it is exactly as safe as the user typing it into the
 * node panel by hand.
 *
 * Deliberately narrow:
 *   - `*Url` keys only — a named destination (`endpoint`, `channel`,
 *     `privacy`, …) stays locked even for a value found in user text.
 *   - Scalar strings only — array fields (`imageUrls`) and the array-walk
 *     leaves stay strict.
 *   - http(s) values only, matched exactly (plus a trailing-punctuation
 *     variant, since the harvest strips `.,;:!?`).
 *   - Denied NODE TYPES are unaffected — a webhook or scraper cannot be
 *     authored no matter whose URL it would carry.
 */
function isUserProvidedLink(key: string, value: unknown, userLinks?: ReadonlySet<string>): boolean {
  if (!userLinks || userLinks.size === 0) return false
  if (!/urls?$/i.test(key)) return false
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  return userLinks.has(trimmed) || userLinks.has(trimmed.replace(/[.,;:!?]+$/, ""))
}

/**
 * Whether the copilot may write this node type.
 *
 * `allowPublishing` is a per-THREAD choice the user makes, never a default and
 * never global: it lifts the publishers only. Everything else in
 * `DENIED_NODE_TYPES` is unreachable regardless, because a webhook or a scraper
 * names its own destination and no toggle should be able to hand a model that.
 *
 * The lock on the fields is untouched either way — `connectionId`, `chatId`,
 * `channel`, `platform` and `privacy` stay the user's. The copilot builds the
 * scaffold; where it goes and who sees it are not its to write.
 */
export function isDeniedNodeType(type: unknown, opts?: { allowPublishing?: boolean }): boolean {
  if (typeof type !== "string") return false
  if (!DENIED_NODE_TYPES.has(type)) return false
  return !(opts?.allowPublishing && SOCIAL_PUBLISHER_TYPES.has(type))
}

/**
 * Every locked-field leaf inside a value, as `[path, jsonValue]`.
 *
 * Used for the array case, where position is not identity: `extraRefs` is a
 * list the user reorders and deletes from, so comparing `after[i]` against
 * `before[i]` reports every element after a removal as changed. What the lock
 * actually cares about is whether a destination is NEW to this node, so the
 * comparison is by VALUE across the whole array.
 */
function lockedLeaves(value: unknown, path: string, out: Array<[string, string]>): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => lockedLeaves(item, `${path}[${i}]`, out))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, inner] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key
    if (isPlainObject(inner) || Array.isArray(inner)) {
      lockedLeaves(inner, here, out)
      continue
    }
    if (!isLockedField(key)) continue
    if (inner === undefined || inner === null || inner === "") continue
    out.push([here, JSON.stringify(inner)])
  }
}

export interface LockedFieldOpts {
  readonly path?: string
  /** Links the user pasted in this thread — see history.ts `extractUserLinks`. */
  readonly userLinks?: ReadonlySet<string>
}

/**
 * Locked fields whose value the model introduced or changed versus `before` —
 * walked recursively, so a destination nested inside a config object counts.
 * Preserving a value that already exists on the node is allowed (it is the
 * user's own), and so is a verbatim user-pasted link (`isUserProvidedLink`).
 */
export function changedLockedUrlFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  opts: LockedFieldOpts = {},
): string[] {
  const path = opts.path ?? ""
  const changed: string[] = []
  for (const [key, next] of Object.entries(after)) {
    const here = path ? `${path}.${key}` : key
    const prev = isPlainObject(before) ? before[key] : undefined

    if (isPlainObject(next)) {
      changed.push(...changedLockedUrlFields(isPlainObject(prev) ? prev : undefined, next, { ...opts, path: here }))
      continue
    }

    // An ORDINARY key holding a list — `extraRefs` is the one that matters, and
    // it was invisible to this lock until now: the walk only descended into
    // plain objects, so a list of `{url}` objects under a key that is not
    // itself locked was waved straight through, and the run engine hands those
    // urls to providers. A LOCKED key holding an array stays a leaf below
    // (`imageUrls` is whole-array preserve-or-reject, unchanged).
    if (!isLockedField(key) && Array.isArray(next)) {
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next)) continue
      const known = new Set<string>()
      const before_: Array<[string, string]> = []
      lockedLeaves(prev, "", before_)
      for (const [, value] of before_) known.add(value)
      const after_: Array<[string, string]> = []
      lockedLeaves(next, here, after_)
      for (const [leafPath, value] of after_) if (!known.has(value)) changed.push(leafPath)
      continue
    }

    if (!isLockedField(key)) continue
    if (next === undefined || next === null || next === "") continue
    if (Array.isArray(next) && next.length === 0) continue
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next)) continue
    if (isUserProvidedLink(key, next, opts.userLinks)) continue
    changed.push(here)
  }
  return changed
}
