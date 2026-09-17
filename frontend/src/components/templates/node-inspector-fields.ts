/**
 * Pure helpers behind the template canvas's node inspector: which fields a
 * node exposes to a reader, in which order, and which node sits under a click.
 * The canvas nodes are inert and `pointer-events: none`, so a click lands on
 * the pane and the node is found by geometry, not by DOM target.
 */

export interface InspectorNode {
  readonly id: string
  readonly type?: string
  readonly data: Readonly<Record<string, unknown>>
}

export interface InspectorField {
  readonly key: string
  readonly label: string
  readonly value: string
}

export interface InspectorSetting {
  readonly label: string
  readonly value: string
}

export interface NodeRect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Long-form text a reader wants in full, in reading order. */
const TEXT_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["prompt", "Prompt"],
  ["negativePrompt", "Negative prompt"],
  ["systemPrompt", "System prompt"],
  ["userInput", "User prompt"],
  ["text", "Text"],
  // Web Scrape: the search query, or the page address it crawled.
  ["query", "Search query"],
  ["generatedText", "Result"],
]

/** Node types whose `url` is an input the reader types (a page to crawl),
 *  not a media result — for every other node `url` is bookkeeping. */
const URL_IS_AN_INPUT = new Set(["web-scrape"])

/** A structured result (Web Scrape, video analysis) is shown as pretty JSON —
 *  it is the node's output exactly as a downstream Prompt node receives it. */
const JSON_RESULT_KEY = "generatedJson"
const JSON_RESULT_MAX = 20_000

function jsonResultField(node: InspectorNode): InspectorField[] {
  const value = node.data[JSON_RESULT_KEY]
  if (value === undefined || value === null) return []
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    return []
  }
  if (!nonEmptyString(text)) return []
  const shown = text.length > JSON_RESULT_MAX ? `${text.slice(0, JSON_RESULT_MAX)}\n…` : text
  return [{ key: JSON_RESULT_KEY, label: "Result", value: shown }]
}

/** Short settings worth a chip, in display order. */
const SETTING_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["provider", "Model"],
  ["llmModel", "Model"],
  ["resolution", "Resolution"],
  ["aspectRatio", "Aspect ratio"],
  ["quality", "Quality"],
  ["duration", "Duration"],
  ["mode", "Mode"],
  ["timestamp", "Seconds"],
  ["filename", "File"],
]

/** Bookkeeping keys that are never a setting a reader cares about. */
const NOT_A_SETTING = new Set([
  "label", "title", "hintMode", "templateId", "style", "className", "color", "textColor", "alignment", "fontSize",
  "url", "r2Url", "thumbnailUrl", "assetId", "mimeType", "kieTaskId", "generatedImageUrl", "generatedVideoUrl",
  ...TEXT_FIELDS.map(([key]) => key),
])
const SHORT_VALUE_MAX = 40

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

export function inspectorFields(node: InspectorNode): InspectorField[] {
  const texts = TEXT_FIELDS.flatMap(([key, label]) => {
    const value = node.data[key]
    if (!nonEmptyString(value)) return []
    const shown = key === "text" && node.type === "sticky-note" ? "Note" : label
    return [{ key, label: shown, value }]
  })
  const address = URL_IS_AN_INPUT.has(node.type ?? "") && nonEmptyString(node.data.url)
    ? [{ key: "url", label: "Address", value: node.data.url }]
    : []
  return [...address, ...texts, ...jsonResultField(node)]
}

/**
 * Known settings first (model, size, seconds). A node with none of them — a
 * picker — shows its own short string fields instead, so the chosen tiles are
 * readable ("lightingStyle · on-camera-flash").
 */
export function inspectorSettings(node: InspectorNode): InspectorSetting[] {
  const known = SETTING_FIELDS.flatMap(([key, label]) => {
    const value = node.data[key]
    if (nonEmptyString(value)) return [{ label, value }]
    if (typeof value === "number" && Number.isFinite(value)) return [{ label, value: String(value) }]
    return []
  })
  if (known.length > 0) return known
  return Object.entries(node.data).flatMap(([key, value]) =>
    !NOT_A_SETTING.has(key) && nonEmptyString(value) && value.length <= SHORT_VALUE_MAX ? [{ label: key, value }] : [],
  )
}

/** The topmost node (last in draw order) whose box contains the point. */
export function nodeAtPoint(rects: readonly NodeRect[], point: { readonly x: number; readonly y: number }): string | null {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const r = rects[i]
    if (r.width <= 0 || r.height <= 0) continue
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return r.id
  }
  return null
}
