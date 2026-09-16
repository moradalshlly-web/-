/** Highest-cost legal partition for each count. Price is evaluated on the
 * provider's normalized duration by the caller, so sparse/nonmonotonic menus
 * are covered without assuming that a longer clip always costs more. */
export function highestCostPartitions(
  durationSec: number,
  bounds: { minSeg: number; maxSeg: number; lossSec: number; maxCount: number },
  price: (rawDuration: number, index: number) => number,
): number[][] {
  const { minSeg, maxSeg, lossSec, maxCount } = bounds
  if (!Number.isInteger(durationSec) || durationSec < minSeg ||
      !Number.isInteger(minSeg) || !Number.isInteger(maxSeg) || maxSeg < minSeg ||
      !Number.isInteger(maxCount) || maxCount < 1 || !Number.isFinite(lossSec) || lossSec < 0) {
    throw new Error("Invalid natural segment reservation bounds")
  }
  const ceiling = Math.ceil(durationSec + lossSec * (maxCount - 1))
  let layer = new Map<number, { cost: number; durations: number[] }>([[0, { cost: 0, durations: [] }]])
  const result: number[][] = []
  for (let index = 0; index < maxCount; index++) {
    const next = new Map<number, { cost: number; durations: number[] }>()
    for (const [sum, prefix] of layer) {
      for (let d = minSeg; d <= maxSeg && sum + d <= ceiling; d++) {
        const unit = price(d, index)
        if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid natural segment reservation price")
        const cost = prefix.cost + unit
        if (!next.has(sum + d) || next.get(sum + d)!.cost < cost) {
          next.set(sum + d, { cost, durations: [...prefix.durations, d] })
        }
      }
    }
    const candidate = next.get(Math.ceil(durationSec + lossSec * index))
    if (candidate) result.push(candidate.durations)
    layer = next
    if (!layer.size) break
  }
  return result
}
