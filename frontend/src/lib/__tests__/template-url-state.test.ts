import { describe, it, expect } from "vitest"
import { readTemplatesUrlState, writeTemplatesUrlState } from "../template-url-state"

const params = (query: string) => new URLSearchParams(query)

describe("readTemplatesUrlState", () => {
  it("reads the bare page as the unfiltered browse view", () => {
    expect(readTemplatesUrlState(params(""))).toEqual({
      category: undefined,
      sort: "popular",
      templateSlug: null,
      view: null,
    })
  })

  it("keeps a known category, reads a legacy one as its new home, drops an unknown one", () => {
    expect(readTemplatesUrlState(params("category=video-ads")).category).toBe("video-ads")
    expect(readTemplatesUrlState(params("category=video-production")).category).toBe("video-ads")
    expect(readTemplatesUrlState(params("category=nonsense")).category).toBeUndefined()
  })

  it("keeps a known sort and falls back to popular", () => {
    expect(readTemplatesUrlState(params("sort=newest")).sort).toBe("newest")
    expect(readTemplatesUrlState(params("sort=cheapest")).sort).toBe("cheapest")
    expect(readTemplatesUrlState(params("sort=bogus")).sort).toBe("popular")
  })

  it("opens the detail view for ?template=<slug>", () => {
    expect(readTemplatesUrlState(params("template=product-photoshoot"))).toMatchObject({
      templateSlug: "product-photoshoot",
      view: "detail",
    })
  })

  it("opens the canvas view only together with a slug", () => {
    expect(readTemplatesUrlState(params("template=x&view=canvas")).view).toBe("canvas")
    expect(readTemplatesUrlState(params("view=canvas"))).toMatchObject({ templateSlug: null, view: null })
  })

  it("ignores a slug that is not a slug", () => {
    expect(readTemplatesUrlState(params("template=../etc")).templateSlug).toBeNull()
  })
})

describe("writeTemplatesUrlState", () => {
  it("returns a new params object and leaves the input alone", () => {
    const input = params("category=brand-assets")
    const next = writeTemplatesUrlState(input, { sort: "newest" })
    expect(input.toString()).toBe("category=brand-assets")
    expect(next.toString()).toBe("category=brand-assets&sort=newest")
  })

  it("drops the default sort instead of writing it", () => {
    expect(writeTemplatesUrlState(params("sort=newest"), { sort: "popular" }).toString()).toBe("")
  })

  it("clears a category with undefined", () => {
    expect(writeTemplatesUrlState(params("category=brand-assets&sort=newest"), { category: undefined }).toString()).toBe(
      "sort=newest",
    )
  })

  it("opens and closes the detail view, taking the canvas flag with it", () => {
    const opened = writeTemplatesUrlState(params("sort=newest"), { templateSlug: "x" })
    expect(opened.toString()).toBe("sort=newest&template=x")
    const canvas = writeTemplatesUrlState(opened, { view: "canvas" })
    expect(canvas.toString()).toBe("sort=newest&template=x&view=canvas")
    const back = writeTemplatesUrlState(canvas, { view: "detail" })
    expect(back.toString()).toBe("sort=newest&template=x")
    expect(writeTemplatesUrlState(canvas, { templateSlug: null }).toString()).toBe("sort=newest")
  })

  it("refuses the canvas flag without a slug", () => {
    expect(writeTemplatesUrlState(params(""), { view: "canvas" }).toString()).toBe("")
  })
})
