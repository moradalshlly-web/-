/**
 * "Your path" on the Explore tab: three first-run milestones, derived from data
 * the client already fetches. There is no stored onboarding state behind it.
 */
export type PathStepId = "image" | "workflow" | "miniapp"
export type PathLevel = "newcomer" | "explorer" | "builder" | "creator"

export interface PathSignals {
  readonly hasGeneratedImage: boolean
  readonly hasMultiNodeWorkflow: boolean
  readonly hasPublishedApp: boolean
}

export interface PathStep {
  readonly id: PathStepId
  readonly done: boolean
}

export interface PathProgress {
  readonly steps: readonly PathStep[]
  readonly doneCount: number
  readonly level: PathLevel
}

export interface PathSources {
  /** The user's `/v1/stats`; undefined while it loads. */
  readonly stats?: { readonly avgImageTime: number | null } | null
  readonly workflows?: readonly {
    readonly nodeTypes: readonly string[] | null
    readonly isDemoSeed: boolean
  }[]
  readonly apps?: readonly {
    readonly isActive: boolean
    readonly deletedAt: string | null
    readonly publishType?: "app" | "component"
  }[]
}

/** Indexed by how many steps are done (0–3). */
const LEVELS: readonly PathLevel[] = ["newcomer", "explorer", "builder", "creator"]

/**
 * The milestone facts, read conservatively: a source that has not loaded counts
 * as "not done", so a step never flashes complete and then un-completes.
 *
 * - image: `/v1/stats` has no per-type counters, but `avgImageTime` averages the
 *   user's COMPLETED image jobs and get_stats COALESCEs it to 0 when there are
 *   none (migration 021) — so only a positive value means one exists.
 * - workflow: `nodeTypes` holds the DISTINCT node types of a flow, so two nodes
 *   of the same type read as one — an undercount, never a false "done". The
 *   seeded Welcome Demo is left out: it arrives as a finished graph, so it
 *   would pre-check this step for every new user.
 * - miniapp: `/v1/apps/mine` also returns soft-deleted rows (only `deletedAt`
 *   is set; `isActive` stays) and marketplace components — neither is a MiniApp
 *   the user has out there.
 */
export function derivePathSignals(sources: PathSources): PathSignals {
  return {
    hasGeneratedImage: (sources.stats?.avgImageTime ?? 0) > 0,
    hasMultiNodeWorkflow: (sources.workflows ?? []).some(
      (w) => !w.isDemoSeed && (w.nodeTypes?.length ?? 0) >= 2,
    ),
    hasPublishedApp: (sources.apps ?? []).some(
      (a) => a.isActive && a.deletedAt === null && a.publishType !== "component",
    ),
  }
}

export function computePathProgress(signals: PathSignals): PathProgress {
  const steps: readonly PathStep[] = [
    { id: "image", done: signals.hasGeneratedImage },
    { id: "workflow", done: signals.hasMultiNodeWorkflow },
    { id: "miniapp", done: signals.hasPublishedApp },
  ]
  const doneCount = steps.filter((s) => s.done).length
  return { steps, doneCount, level: LEVELS[doneCount] }
}
