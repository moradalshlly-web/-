import { describe, it, expect } from "vitest"
import { isScrapeNodeType, scrapeJobNeedsApplying, scrapeResultPatch } from "../scrape-result-recovery"

const T = Date.parse("2026-09-19T18:25:59.000Z")
const at = (offsetMs: number) => new Date(T + offsetMs).toISOString()

describe("isScrapeNodeType", () => {
  it("names the three scrapers and nothing else", () => {
    expect(["web-scrape", "meta-ads-scrape", "instagram-scrape"].every(isScrapeNodeType)).toBe(true)
    expect(isScrapeNodeType("video-analysis")).toBe(false)
    expect(isScrapeNodeType("toString")).toBe(false)
    expect(isScrapeNodeType(undefined)).toBe(false)
  })
})

describe("scrapeResultPatch", () => {
  it("is the live run's own patch, plus the job the payload came from", () => {
    const json = { pages: [{ url: "https://owalalife.com/" }, { url: "https://owalalife.com/collections/all" }] }
    expect(scrapeResultPatch("web-scrape", json, "job-1")).toMatchObject({
      executionStatus: "completed",
      lastRunOutcome: "success",
      lastRunCount: 2,
      lastGoodCount: 2,
      generatedJson: json,
      lastAppliedJobId: "job-1",
    })
  })

  it("keeps the #765 contract — an empty result records the outcome and never touches the payload", () => {
    const patch = scrapeResultPatch("web-scrape", [], "job-2")!
    expect(patch).toMatchObject({ lastRunOutcome: "empty", lastRunCount: 0, lastAppliedJobId: "job-2" })
    expect("generatedJson" in patch).toBe(false)
  })

  it("carries each scraper's own extras", () => {
    expect(scrapeResultPatch("instagram-scrape", [{ caption: "x" }], "j")).toMatchObject({ featuredIndex: 0, viewFormat: "all" })
    expect(scrapeResultPatch("meta-ads-scrape", [{ id: "ad" }], "j")).toMatchObject({ featuredIndex: 0, viewFormat: "all" })
  })

  it("answers null for a node that is not a scraper", () => {
    expect(scrapeResultPatch("generate-image", [], "j")).toBeNull()
  })
})

describe("scrapeJobNeedsApplying", () => {
  // The run this exists for: started 18:25:58 in the browser, the job created a
  // second later, the held request cut off at the edge ~100 s in ("Web scrape
  // failed"), the crawl finishing server-side at 252 s — billed.
  const cutOffAtTheEdge = {
    lastRunStartedAt: T - 1_000,
    lastRunOutcome: "failed",
    lastRunAt: T + 100_000,
    errorMessage: "Web scrape failed",
  }

  it("applies the job of a run the node recorded as failed", () => {
    expect(scrapeJobNeedsApplying(cutOffAtTheEdge, { id: "job-1", createdAt: at(0) })).toBe(true)
  })

  it("applies it over a PREVIOUS good payload — holding a result is a scrape node's normal state", () => {
    const data = { ...cutOffAtTheEdge, generatedJson: { pages: [{ url: "old" }] }, lastGoodAt: T - 3_600_000, lastGoodCount: 1 }
    expect(scrapeJobNeedsApplying(data, { id: "job-1", createdAt: at(0) })).toBe(true)
  })

  it("applies the job of a run that never settled — the tab closed mid-crawl", () => {
    const data = { lastRunStartedAt: T - 1_000, lastRunOutcome: "success", lastRunAt: T - 3_600_000 }
    expect(scrapeJobNeedsApplying(data, { id: "job-1", createdAt: at(0) })).toBe(true)
  })

  it("applies a QUICK rerun: started a minute after the last success, then abandoned", () => {
    const data = { lastRunStartedAt: T - 1_000, lastRunOutcome: "success", lastRunAt: T - 60_000 }
    expect(scrapeJobNeedsApplying(data, { id: "job-1", createdAt: at(0) })).toBe(true)
  })

  it("never applies the same job twice", () => {
    expect(scrapeJobNeedsApplying({ ...cutOffAtTheEdge, lastAppliedJobId: "job-1" }, { id: "job-1", createdAt: at(0) })).toBe(false)
  })

  it("never touches a node with a run live on it", () => {
    for (const executionStatus of ["running", "pending"]) {
      expect(scrapeJobNeedsApplying({ ...cutOffAtTheEdge, executionStatus }, { id: "job-1", createdAt: at(0) })).toBe(false)
    }
  })

  it("never resurrects a job from BEFORE the node's last run — that run failed on its own terms", () => {
    const olderJob = { id: "job-0", createdAt: at(-600_000) }
    expect(scrapeJobNeedsApplying(cutOffAtTheEdge, olderJob)).toBe(false)
  })

  it("tolerates a browser clock running ahead of the server by less than two minutes", () => {
    const fastClock = { ...cutOffAtTheEdge, lastRunStartedAt: T + 90_000 }
    expect(scrapeJobNeedsApplying(fastClock, { id: "job-1", createdAt: at(0) })).toBe(true)
    expect(scrapeJobNeedsApplying({ ...fastClock, lastRunStartedAt: T + 180_000 }, { id: "job-1", createdAt: at(0) })).toBe(false)
  })

  it("leaves a settled run alone — that settlement IS this job", () => {
    // Applied live by a build that did not record job ids yet.
    const legacy = { lastRunStartedAt: T - 1_000, lastRunOutcome: "success", lastRunAt: T + 20_000, generatedJson: [{ title: "T" }] }
    expect(scrapeJobNeedsApplying(legacy, { id: "job-1", createdAt: at(0) })).toBe(false)
    expect(scrapeJobNeedsApplying({ ...legacy, lastRunOutcome: "empty" }, { id: "job-1", createdAt: at(0) })).toBe(false)
  })

  it("still leaves it alone when the browser clock runs a minute BEHIND the server", () => {
    // Every browser stamp is 60 s early, so the settlement reads as older than
    // the job it came from. Re-applying would reset the featured post and the
    // view filter under the user — for a result the node already holds.
    const slowClock = { lastRunStartedAt: T - 61_000, lastRunOutcome: "success", lastRunAt: T - 40_000, generatedJson: [{ caption: "x" }] }
    expect(scrapeJobNeedsApplying(slowClock, { id: "job-1", createdAt: at(0) })).toBe(false)
  })

  it("asks whether the LAST run settled on one clock — a success from before it began is an earlier run", () => {
    // success at T-60 s, then a new run started at T-1 s and never settled.
    const unsettledRerun = { lastRunStartedAt: T - 1_000, lastRunOutcome: "success", lastRunAt: T - 60_000 }
    expect(scrapeJobNeedsApplying(unsettledRerun, { id: "job-2", createdAt: at(0) })).toBe(true)
  })

  it("applies a job clearly newer than the settled run — a rerun whose start never got saved", () => {
    const tenMinutesAgo = { lastRunStartedAt: T - 620_000, lastRunOutcome: "success", lastRunAt: T - 600_000 }
    expect(scrapeJobNeedsApplying(tenMinutesAgo, { id: "job-2", createdAt: at(0) })).toBe(true)
    // Inside the tolerance it cannot be told from the settled run's own job, and
    // errs safe: nothing is overwritten.
    const justNow = { lastRunStartedAt: T - 80_000, lastRunOutcome: "success", lastRunAt: T - 60_000 }
    expect(scrapeJobNeedsApplying(justNow, { id: "job-2", createdAt: at(0) })).toBe(false)
  })

  it("refuses to guess without a usable creation time", () => {
    expect(scrapeJobNeedsApplying(cutOffAtTheEdge, { id: "job-1" })).toBe(false)
    expect(scrapeJobNeedsApplying(cutOffAtTheEdge, { id: "job-1", createdAt: "not a date" })).toBe(false)
  })
})
