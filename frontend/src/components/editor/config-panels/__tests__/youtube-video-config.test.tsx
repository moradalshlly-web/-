// The Video URL node's settings panel. It used to carry its own copy of the
// platform regexes and the download flow (and knew nothing of the audio track
// the card fetched); it now writes through the same controller as the card and
// renders the same download block.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const setVideoLinkUrl = vi.fn()
vi.mock("@/lib/video-link-ingest", () => ({
  setVideoLinkUrl: (...a: unknown[]) => setVideoLinkUrl(...a),
}))

const statusProps = vi.fn()
vi.mock("@/components/nodes/video-link-status", () => ({
  VideoLinkStatus: (props: Record<string, unknown>) => {
    statusProps(props)
    return <div data-testid="video-link-status" />
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) => selector({ edges: [], nodes: [] }),
}))
vi.mock("@/lib/api", () => ({ uploadAudio: vi.fn(), fetchYouTubeOEmbed: vi.fn() }))
vi.mock("@/ee/components/credits/StorageExceededModal", () => ({ StorageExceededModal: () => null }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: { src: string; alt: string }) => <img data-testid="thumb" src={props.src} alt={props.alt} />,
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  resolveEdgeValuesForTableColumn: () => null,
}))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({ useSnippetPool: () => [] }))

import { YouTubeVideoConfig } from "../input-configs"
import { translate } from "@/lib/i18n"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"

function renderPanel(data: Record<string, unknown>, nodeId: string | null = "n1") {
  const onUpdate = vi.fn()
  const props = {
    data: { label: "Video URL", youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "", ...data },
    onUpdate,
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: [],
    nodeId,
  } as any
  render(<YouTubeVideoConfig {...props} />)
  return { onUpdate }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("YouTubeVideoConfig", () => {
  it("writes the link through the controller — never straight into node data", () => {
    const { onUpdate } = renderPanel({})
    fireEvent.change(screen.getByLabelText(translate("en", "inputcfg.videoUrl")), { target: { value: YT } })
    expect(setVideoLinkUrl).toHaveBeenCalledWith("n1", YT)
    // A direct write would skip the reset of the previous link's file and the
    // download itself — exactly how the panel and the card drifted apart.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("renders the shared download block for this node", () => {
    renderPanel({ youtubeUrl: YT, videoId: "aqz-KE-bpKQ" })
    expect(screen.getByTestId("video-link-status")).toBeInTheDocument()
    expect(statusProps).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "n1", variant: "panel" }))
  })

  it("shows the downloaded file's thumbnail over the link's own, and the title", () => {
    renderPanel({
      youtubeUrl: YT,
      videoId: "aqz-KE-bpKQ",
      title: "Big Buck Bunny",
      thumbnailUrl: "https://img.youtube.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      downloadedThumbnailUrl: "https://cdn.nodaro.ai/thumbnails/yt-1.jpg",
    })
    expect(screen.getByTestId("thumb")).toHaveAttribute("src", "https://cdn.nodaro.ai/thumbnails/yt-1.jpg")
    expect(screen.getByText("Big Buck Bunny")).toBeInTheDocument()
  })

  it("stays inert without a node id rather than writing to nowhere", () => {
    renderPanel({}, null)
    fireEvent.change(screen.getByLabelText(translate("en", "inputcfg.videoUrl")), { target: { value: YT } })
    expect(setVideoLinkUrl).not.toHaveBeenCalled()
    expect(screen.queryByTestId("video-link-status")).toBeNull()
  })
})
