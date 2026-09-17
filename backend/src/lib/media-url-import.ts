import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { safeFetch } from "./safe-fetch.js"
import { supabase } from "./supabase.js"
import { uploadLocalFileToR2Key } from "./storage.js"
import { applyUploadPolicies } from "./upload-policy.js"
import {
  checkStorageQuota,
  refundStorage,
  reserveStorageIfWithinLimit,
} from "../utils/file-validation.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Server-side import of a remote AUDIO/VIDEO recording into the caller's
 * storage — the long-file ingest lane for the podcast-editing primitives.
 *
 * WHY THIS EXISTS (Q7, option C). Multi-GB podcast recordings can't be uploaded
 * from the browser (the web lane caps at 500 MB), and presigned direct-to-R2
 * multipart is deliberately CI-forbidden (`upload-policy.test.ts`) because it
 * bypasses the `upload-policy` byte-moderation seam. Podcast creators almost
 * always already HOST their recording with a URL (Riverside/Zoom/Descript
 * exports, Drive/Dropbox direct links), so the backend fetches it server-side
 * — bytes flow through us (seam-respecting, no presigner) — and lands it on R2.
 *
 * Security posture (mirrors media-import.ts, extended to streaming):
 *   - the route validates the URL syntactically (`safeUrlSchema`);
 *   - `safeFetch` is the authoritative SSRF gate (resolved-IP validation per hop);
 *   - the body STREAMS to a temp file (never buffered — a multi-GB file would
 *     OOM) with a HARD byte cap that aborts mid-stream (Content-Length is
 *     advisory/attacker-controlled, used only for an early fast-fail);
 *   - the bytes must PROBE as real media (`probeMediaDuration` via ffprobe is
 *     the authoritative gate — the Content-Type header is a fast-fail hint);
 *   - `applyUploadPolicies` is asked BEFORE any R2 write. For a streamed
 *     multi-GB import the policy sees METADATA (kind/mime/size/user), not a full
 *     buffer — honest and materially better than a presigned lane (bytes DO
 *     pass through us, so a future streaming-policy variant can inspect them).
 *
 * KNOWN LIMITS (documented follow-ups, not oversights):
 *   - no per-user import concurrency limit yet — the byte cap + temp cleanup
 *     bound a single import, but many concurrent 8 GB imports could pressure
 *     worker disk; add a per-user in-flight cap.
 *   - quota is reserved AFTER the download completes (final size is unknown
 *     until then; Content-Length is advisory) — a quota-exceeding import wastes
 *     the transfer. Acceptable: quota is the user's own limit, not a moderation
 *     gate. The pre-download metadata policy still runs first.
 *   - the source must serve a recognized audio/video Content-Type; probe-based
 *     kind detection for typeless direct links is a follow-up.
 */

/** Podcast source ceiling. Configurable if a self-host needs a smaller cap. */
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024 * 1024 // 8 GB
/** Per-source duration cap (matches the podcast nodes' 3-hour limit). */
export const IMPORT_MAX_DURATION_SEC = 3 * 60 * 60
/** Total fetch timeout — a blunt bound on an 8 GB stream (~5 MB/s worst case ≈ 27 min). */
const IMPORT_FETCH_TIMEOUT_MS = 40 * 60_000

/** Content-Type → {ext, mime, kind}. The probe is authoritative; this pins the
 *  stored key extension + served content-type honestly for the common containers. */
const ACCEPTED_AV: Record<string, { ext: string; mime: string; kind: "video" | "audio" }> = {
  "video/mp4": { ext: "mp4", mime: "video/mp4", kind: "video" },
  "video/quicktime": { ext: "mov", mime: "video/quicktime", kind: "video" },
  "video/webm": { ext: "webm", mime: "video/webm", kind: "video" },
  "video/x-matroska": { ext: "mkv", mime: "video/x-matroska", kind: "video" },
  "audio/mpeg": { ext: "mp3", mime: "audio/mpeg", kind: "audio" },
  "audio/mp3": { ext: "mp3", mime: "audio/mpeg", kind: "audio" },
  "audio/mp4": { ext: "m4a", mime: "audio/mp4", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", mime: "audio/mp4", kind: "audio" },
  "audio/aac": { ext: "aac", mime: "audio/aac", kind: "audio" },
  "audio/wav": { ext: "wav", mime: "audio/wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", mime: "audio/wav", kind: "audio" },
  "audio/webm": { ext: "weba", mime: "audio/webm", kind: "audio" },
  "audio/ogg": { ext: "ogg", mime: "audio/ogg", kind: "audio" },
}

/** Obviously-not-media Content-Types — fail before streaming a byte. */
const OBVIOUS_NON_AV = /^(text\/|image\/|application\/(json|xml|pdf|x-www-form-urlencoded)|multipart\/)/i

export type MediaUrlImportResult =
  | {
      ok: true
      url: string
      assetId: string | null
      mimeType: string
      sizeBytes: number
      durationSec: number
      kind: "video" | "audio"
      filename: string
    }
  | { ok: false; status: 400 | 403 | 413 | 422; code: string; message: string; details?: Record<string, unknown> }

/** Marker so the byte-cap abort is distinguishable from a network error. */
class ImportTooLargeError extends Error {
  constructor() {
    super("import exceeds the byte cap")
    this.name = "ImportTooLargeError"
  }
}

function filenameFromUrl(url: string, ext: string): string {
  try {
    const seg = new URL(url).pathname.split("/").pop()
    if (seg) return decodeURIComponent(seg)
  } catch {
    // fall through
  }
  return `imported-${randomUUID()}.${ext}`
}

export async function importRecordingFromUrl(userId: string, url: string): Promise<MediaUrlImportResult> {
  // ── Fetch (SSRF-gated) ──
  let res: Response
  try {
    res = await safeFetch(url, { timeoutMs: IMPORT_FETCH_TIMEOUT_MS })
  } catch (err) {
    return { ok: false, status: 422, code: "fetch_failed", message: `Couldn't fetch that URL: ${(err as Error).message}` }
  }
  if (!res.ok) {
    return { ok: false, status: 422, code: "fetch_failed", message: `The URL responded with HTTP ${res.status}` }
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (OBVIOUS_NON_AV.test(contentType)) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, status: 400, code: "validation_error", message: `That URL serves ${contentType || "an unknown type"}, not audio or video` }
  }
  const meta = ACCEPTED_AV[contentType]
  if (!meta) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, status: 400, code: "validation_error", message: `Couldn't determine a supported audio/video type from Content-Type "${contentType || "(none)"}"` }
  }

  // Early fast-fails on the advisory Content-Length.
  const declaredLen = Number(res.headers.get("content-length"))
  if (Number.isFinite(declaredLen) && declaredLen > IMPORT_MAX_BYTES) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, status: 413, code: "file_too_large", message: `Recordings up to ${IMPORT_MAX_BYTES / (1024 ** 3)}GB can be imported` }
  }
  if (!res.body) {
    return { ok: false, status: 422, code: "fetch_failed", message: "The URL returned no body" }
  }

  // ── Policy BEFORE any write (metadata; a streamed multi-GB body is not buffered) ──
  const preDecision = await applyUploadPolicies({
    kind: meta.kind,
    lane: "media-import",
    mime: meta.mime,
    sizeBytes: Number.isFinite(declaredLen) ? declaredLen : 0,
    userId,
  })
  if (!preDecision.allow) {
    await res.body.cancel().catch(() => {})
    return { ok: false, status: 403, code: "upload_blocked", message: preDecision.reason || "This import is not allowed on this deployment" }
  }

  // ── Stream to a temp file with a hard cap ──
  const dir = join(tmpdir(), `media-url-import-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const tmpPath = join(dir, `source.${meta.ext}`)
  try {
    let received = 0
    const capper = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        if (received > IMPORT_MAX_BYTES) cb(new ImportTooLargeError())
        else cb(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), capper, createWriteStream(tmpPath))

    // ── Probe: authoritative media gate + duration cap ──
    let durationSec = 0
    try {
      durationSec = await probeMediaDuration(tmpPath)
    } catch {
      durationSec = 0
    }
    if (!durationSec || durationSec <= 0) {
      return { ok: false, status: 400, code: "validation_error", message: "That URL doesn't point to a decodable audio/video file" }
    }
    if (durationSec > IMPORT_MAX_DURATION_SEC) {
      return { ok: false, status: 413, code: "duration_exceeded", message: `Recordings up to ${IMPORT_MAX_DURATION_SEC / 3600} hours can be imported` }
    }

    const sizeBytes = (await stat(tmpPath)).size

    // ── Atomic storage reservation (same race-free RPC as /v1/upload) ──
    const reserved = await reserveStorageIfWithinLimit(userId, sizeBytes)
    if (!reserved) {
      const quota = await checkStorageQuota(userId, sizeBytes)
      return {
        ok: false,
        status: 413,
        code: "storage_limit_exceeded",
        message: quota.error ?? "Storage limit exceeded",
        details: { usedBytes: quota.usedBytes, quotaBytes: quota.quotaBytes, remainingBytes: quota.remainingBytes, tier: quota.tier },
      }
    }

    // ── R2 upload (reservation already counted the bytes — no trackUserId) ──
    const fileId = randomUUID()
    const key = `uploads/${meta.kind}s/${fileId}.${meta.ext}`
    let publicUrl: string
    try {
      publicUrl = await uploadLocalFileToR2Key(tmpPath, key, meta.mime)
    } catch (err) {
      await refundStorage(userId, sizeBytes)
      throw err
    }

    // ── Asset record (LOUD on failure — a lost row is a permanent quota leak) ──
    const filename = filenameFromUrl(url, meta.ext)
    let assetId: string | null = null
    const { data: asset, error: insertError } = await supabase
      .from("assets")
      .insert({
        user_id: userId,
        type: meta.kind,
        filename,
        mime_type: meta.mime,
        size_bytes: sizeBytes,
        r2_key: key,
        r2_url: publicUrl,
        upload_source: "url_import",
        metadata: { source_url: url, duration_sec: durationSec },
      })
      .select("id")
      .single()
    if (insertError) {
      console.error(`[media-url-import] ORPHANED ${sizeBytes} bytes at ${key} for user ${userId}: asset insert failed —`, insertError)
    } else {
      assetId = asset.id
    }

    return { ok: true, url: publicUrl, assetId, mimeType: meta.mime, sizeBytes, durationSec, kind: meta.kind, filename }
  } catch (err) {
    if (err instanceof ImportTooLargeError) {
      return { ok: false, status: 413, code: "file_too_large", message: `Recordings up to ${IMPORT_MAX_BYTES / (1024 ** 3)}GB can be imported` }
    }
    return { ok: false, status: 422, code: "fetch_failed", message: `Import failed: ${(err as Error).message}` }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
