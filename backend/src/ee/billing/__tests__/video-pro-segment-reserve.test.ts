import { describe, expect, it } from "vitest"
import { highestCostPartitions } from "../video-pro-segment-reserve.js"

describe("natural segment reservation partitions", () => {
  it("matches exhaustive enumeration even with nonmonotonic duration prices", () => {
    const price = [0, 0, 0, 0, 11, 90, 12, 60, 19]
    const candidates = highestCostPartitions(12, { minSeg: 4, maxSeg: 8, lossSec: .3, maxCount: 24 }, (s, i) => price[s]! + (i ? 7 : 0))
    for (let n = 1; n <= 3; n++) {
      const target = Math.ceil(12 + .3 * (n - 1))
      const all: number[][] = []
      const walk = (arr: number[]) => {
        if (arr.length === n) { if (arr.reduce((a,b) => a+b,0) === target) all.push(arr); return }
        for (let d=4; d<=8; d++) walk([...arr,d])
      }
      walk([])
      const got = candidates.find(x => x.length === n)
      if (!all.length) { expect(got).toBeUndefined(); continue }
      const cost = (a: number[]) => a.reduce((sum,d,i) => sum+price[d]!+(i?7:0),0)
      expect(cost(got!)).toBe(Math.max(...all.map(cost)))
    }
  })
  it("never exceeds bounds or count, and keeps the exact seam-adjusted total", () => {
    for (let d=4; d<=120; d++) for (const parts of highestCostPartitions(d, {minSeg:4,maxSeg:30,lossSec:.3,maxCount:24}, (s)=>s)) {
      expect(parts.length).toBeLessThanOrEqual(24)
      expect(parts.every(x=>x>=4 && x<=30 && Number.isInteger(x))).toBe(true)
      expect(parts.reduce((a,b)=>a+b,0)).toBe(Math.ceil(d+.3*(parts.length-1)))
    }
  })
})
