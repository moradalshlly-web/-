/**
 * Run `fn` over `items` with bounded parallelism, and stop STARTING new work
 * once the deadline has passed (work already started finishes). Returns
 * true when the deadline cut the run short. Shared by the scrape-time media
 * step and the per-ad analysis, which both live inside one request budget.
 */
export async function deadlinePool<T>(
  items: readonly T[],
  concurrency: number,
  deadlineAt: number,
  now: () => number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<boolean> {
  let next = 0
  let hitDeadline = false
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      if (now() >= deadlineAt) {
        hitDeadline = true
        return
      }
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return hitDeadline
}
