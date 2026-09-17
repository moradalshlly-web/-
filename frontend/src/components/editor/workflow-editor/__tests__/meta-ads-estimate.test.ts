/**
 * The Meta Ads credit estimate — and the invariant that the surfaces which
 * quote it can never disagree:
 *
 *   1. the node card           (meta-ads-scrape-node.tsx → estimateNodeCredits)
 *   2. the canvas / run total  (getModelIdentifier → live model-cost row, the
 *                               pre-run precheck and the >100cr confirm gate)
 *
 * Both read ONE builder (`buildMetaAdsScrapeCreditId`, packages/shared) on the
 * same two inputs — `count` and the number of page urls — so a 5-pages × 100
 * node can never show 500 on the card and 20 in the run dialog. Numbers are
 * read from `META_ADS_SCRAPE_CREDIT_COSTS`, never hand-typed.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

import { META_ADS_SCRAPE_CREDIT_COSTS } from "@nodaro/shared"
import { estimateNodeCredits } from "../types"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode } from "@/types/nodes"

function metaAdsNode(data: Record<string, unknown> = {}): WorkflowNode {
  return { id: "m", type: "meta-ads-scrape", position: { x: 0, y: 0 }, data: { label: "Meta Ads", ...data } } as unknown as WorkflowNode
}

const PAGES_3 = "https://www.facebook.com/a\nhttps://www.facebook.com/b\nhttps://www.facebook.com/c"
const PAGES_5 = Array.from({ length: 5 }, (_, i) => `https://www.facebook.com/p${i}`).join("\n")

describe("meta-ads-scrape credit estimate parity", () => {
  it.each([
    ["fresh node (defaults)", {}, "meta-ads-scrape:20"],
    ["keyword search, 50 ads", { mode: "search", query: "shoes", count: 50 }, "meta-ads-scrape:50"],
    ["3 pages × 30 ads → 90 → 100 tier", { mode: "pages", pageUrls: PAGES_3, count: 30 }, "meta-ads-scrape:100"],
    ["5 pages × 100 ads → top tier", { mode: "pages", pageUrls: PAGES_5, count: 100 }, "meta-ads-scrape:500"],
    ["pages mode with no urls yet counts as one source", { mode: "pages", pageUrls: "", count: 20 }, "meta-ads-scrape:20"],
  ])("%s: run total id and card credits agree", (_label, data, expectedId) => {
    const node = metaAdsNode(data)
    expect(getModelIdentifier(node)).toBe(expectedId)
    expect(estimateNodeCredits(node)).toBe(META_ADS_SCRAPE_CREDIT_COSTS[expectedId])
  })
})
