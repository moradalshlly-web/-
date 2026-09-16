import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TemplateResultsRail } from "../template-results-rail"

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data })

describe("TemplateResultsRail", () => {
  it("renders nothing for a snapshot without results", () => {
    const { container } = render(<TemplateResultsRail snapshotNodes={[node("p", "upload-image", { url: "https://cdn/p.png" })]} />)
    expect(container.firstChild).toBeNull()
  })

  it("plays results with native controls and sound — never muted", () => {
    const { container } = render(
      <TemplateResultsRail
        snapshotNodes={[
          node("spot", "merge-video-audio", { label: "TV spot", presentationOutput: true, generatedResults: [{ url: "https://cdn/v/spot.mp4", thumbnailUrl: "https://cdn/t.png" }] }),
          node("music", "suno-generate", { label: "Soundtrack", generatedResults: [{ url: "https://cdn/a/track.wav" }] }),
        ]}
      />,
    )
    const video = container.querySelector("video")
    const audio = container.querySelector("audio")
    expect(video?.getAttribute("src")).toBe("https://cdn/v/spot.mp4")
    expect(video?.hasAttribute("controls")).toBe(true)
    expect(video?.hasAttribute("muted")).toBe(false)
    expect(video?.hasAttribute("autoplay")).toBe(false)
    expect(audio?.getAttribute("src")).toBe("https://cdn/a/track.wav")
    expect(audio?.hasAttribute("controls")).toBe(true)
    expect(container.textContent).toContain("TV spot")
    expect(container.textContent).toContain("Soundtrack")
  })
})
