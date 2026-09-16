/**
 * The playable media a template's snapshot carries — its generated results,
 * read straight off the snapshot nodes so the marketplace can offer a real
 * player (sound on, play/pause) next to the inert read-only canvas.
 */
export type TemplateResultKind = "video" | "audio" | "image"

export interface TemplateResult {
  readonly nodeId: string
  readonly label: string
  readonly kind: TemplateResultKind
  readonly url: string
  readonly posterUrl?: string
}

interface SnapshotResult {
  readonly url?: unknown
  readonly thumbnailUrl?: unknown
}

interface SnapshotNodeData {
  readonly label?: unknown
  readonly presentationOutput?: unknown
  readonly generatedResults?: unknown
  readonly activeResultIndex?: unknown
  readonly generatedVideoUrl?: unknown
  readonly generatedAudioUrl?: unknown
  readonly generatedImageUrl?: unknown
  readonly thumbnailUrl?: unknown
}

interface SnapshotNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac)(\?|#|$)/i

const asString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
// Snapshot data is publisher-written: only a web URL is ever handed to a media element.
const asMediaUrl = (v: unknown): string | undefined => {
  const s = asString(v)
  return s && /^https?:\/\//i.test(s) ? s : undefined
}

/**
 * The URL's own extension decides the kind, so a new node type that produces
 * a video or a track is covered without a list to maintain; the field the
 * URL came from is the fallback for extension-less URLs.
 */
function kindOf(url: string, data: SnapshotNodeData): TemplateResultKind {
  if (VIDEO_EXT.test(url)) return "video"
  if (AUDIO_EXT.test(url)) return "audio"
  if (asString(data.generatedVideoUrl) === url) return "video"
  if (asString(data.generatedAudioUrl) === url) return "audio"
  return "image"
}

function activeResult(data: SnapshotNodeData): SnapshotResult | undefined {
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as SnapshotResult[]) : []
  if (results.length === 0) return undefined
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  return results[index] ?? results[0]
}

const isNode = (v: unknown): v is SnapshotNode => typeof v === "object" && v !== null

function resultOf(node: unknown): TemplateResult | undefined {
  if (!isNode(node) || typeof node.data !== "object" || node.data === null) return undefined
  const id = asString(node.id)
  const data = node.data as SnapshotNodeData
  if (!id) return undefined
  const active = activeResult(data)
  const url =
    asMediaUrl(active?.url) ??
    asMediaUrl(data.generatedVideoUrl) ??
    asMediaUrl(data.generatedAudioUrl) ??
    asMediaUrl(data.generatedImageUrl)
  if (!url) return undefined
  const kind = kindOf(url, data)
  const poster = asMediaUrl(active?.thumbnailUrl) ?? asMediaUrl(data.thumbnailUrl)
  return {
    nodeId: id,
    label: asString(data.label) ?? asString(node.type) ?? id,
    kind,
    url,
    ...(kind === "video" && poster ? { posterUrl: poster } : {}),
  }
}

/**
 * Every generated result in the snapshot, the template's declared outputs
 * first (in canvas order), then the intermediate ones. Inputs never appear:
 * an upload carries its file as `url`, not as a generated result.
 */
export function templateResults(snapshotNodes: readonly unknown[]): TemplateResult[] {
  const isOutput = (n: unknown) => isNode(n) && (n.data as SnapshotNodeData | undefined)?.presentationOutput === true
  const collect = (list: readonly unknown[]) => list.map(resultOf).filter((r): r is TemplateResult => r !== undefined)
  return [...collect(snapshotNodes.filter(isOutput)), ...collect(snapshotNodes.filter((n) => !isOutput(n)))]
}
