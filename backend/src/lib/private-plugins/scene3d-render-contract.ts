/** Durable scene renders under an already reserved parent operation. */
export interface PluginSceneRenderScope {
  parentJobId: string
  userId: string
  /** Stable within the parent: replay addresses the same child. */
  key: string
}

export interface PluginSceneRenderInput extends PluginSceneRenderScope {
  plan: unknown
  /** `owned-build` reads the active parent's received, unpublished artifacts. */
  assets: "retained-revision" | "owned-build"
  /**
   * `artifactKind` is the kind each rendered frame is RESERVED under, and it
   * defaults to `poster`.
   *
   * A delivery pins a shot still as `shot-still`, and publication matches every
   * pin against its reservation's kind and object key — so a still reserved as
   * a `poster` and pinned as a `shot-still` is refused as "not reserved by this
   * parent" (measured on staging job 2ad83d9a, 2026-09-14: the first Pro run
   * whose scene was accepted, lost at delivery). The caller knows which frames
   * become shot stills; the renderer reserves them under that name.
   */
  output: { kind: "video" } | { kind: "stills"; frames: number[]; artifactKind?: "poster" | "shot-still" }
}

export type PluginSceneRenderResult =
  | { kind: "video"; videoUrl: string; sceneRevisionId: string; elapsedMs: number }
  | { kind: "stills"; sceneRevisionId: string; elapsedMs: number;
      frames: Array<{ frame: number; artifactId: string; sha256: string; byteLength: number }> }

export interface PluginSceneRenderStatus {
  childJobId: string
  state: "pending" | "running" | "completed" | "failed" | "cancelled"
  /** A cancelled DB row is not proof that Chromium has stopped. */
  drained: boolean
  progress: number
  result?: PluginSceneRenderResult
  error?: string
}

export interface PluginSceneRenderingToolkit {
  submit(input: PluginSceneRenderInput, options?: { signal?: AbortSignal }): Promise<{ childJobId: string; adopted: boolean }>
  status(input: PluginSceneRenderScope): Promise<PluginSceneRenderStatus>
  /** Requests cancellation; poll status until drained before releasing the parent stage. */
  cancel(input: PluginSceneRenderScope): Promise<PluginSceneRenderStatus>
}
