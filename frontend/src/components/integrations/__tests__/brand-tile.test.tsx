import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BrandTile, BRAND_TILE_INTERNALS } from "../brand-tile"

const { PLATFORM_ICONS, BRAND_INK, monogram } = BRAND_TILE_INTERNALS

describe("BrandTile", () => {
  /**
   * The icon set is generic by necessity — TikTok and Twitch both land on
   * lucide's `Video`, WordPress and Mastodon both on `Globe`. So the COLOUR is
   * what tells two cards apart, and a network with an icon but no ink renders
   * identically to its twin. That is invisible in a screenshot and obvious to
   * a user, which is exactly the kind of thing a list forgets; this caught
   * Discord.
   */
  it("gives every network that has an icon a colour to tell it apart by", () => {
    const withoutInk = Object.keys(PLATFORM_ICONS).filter((id) => !(id in BRAND_INK))
    expect(withoutInk, "icon but no brand colour").toEqual([])
  })

  it("keeps the colours as literal hex, which is what color-mix() needs", () => {
    for (const [id, ink] of Object.entries(BRAND_INK)) {
      expect(ink, id).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it("renders a monogram when the network has no icon of its own", () => {
    render(<BrandTile platformId="brand-new-network" label="Fedi Thing" />)
    expect(screen.getByText("FE")).toBeTruthy()
  })

  it("builds the monogram from letters only, so punctuation never leaks in", () => {
    expect(monogram("Dev.to")).toBe("DE")
    expect(monogram("X")).toBe("X")
    expect(monogram("!!!")).toBe("?")
  })

  it("drops the brand colour entirely when muted", () => {
    const { container } = render(<BrandTile platformId="instagram" label="Instagram" muted />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.className).toContain("integ-brand-tile-muted")
    expect(tile.getAttribute("style")).toBeNull()
  })

  it("passes the brand colour as the custom property the stylesheet mixes from", () => {
    const { container } = render(<BrandTile platformId="instagram" label="Instagram" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.className).toContain("integ-brand-tile")
    expect(tile.getAttribute("style")).toContain("--brand-ink")
  })

  /**
   * A network the registry adds before this file catches up must still render
   * something readable — never a tile mixing against `undefined`.
   */
  it("falls back to the neutral tile for a network it has never heard of", () => {
    const { container } = render(<BrandTile platformId="nothing-here" label="Nothing" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.className).toContain("integ-brand-tile-muted")
    expect(tile.getAttribute("style")).toBeNull()
  })
})
