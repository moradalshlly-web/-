import { describe, it, expect } from "vitest"
import { buildAudioOntoVideoArgs } from "../ffmpeg-utils.js"

/**
 * Kinetic captions are rendered by Remotion from an input transcoded `-an`
 * (audio dropped for fast frame seeking), so the render is silent. The render
 * worker restores sound by muxing the audio-bearing source download back over
 * the captioned picture. These args copy the video untouched and lay the
 * source's first audio stream on top; the source's audio codec decides copy
 * vs re-encode, mirroring buildRemuxArgs.
 */
describe("buildAudioOntoVideoArgs", () => {
  it("copies the video and stream-copies aac/mp3 source audio", () => {
    for (const codec of ["aac", "mp3"]) {
      const args = buildAudioOntoVideoArgs("cap.mp4", "src.mp4", "out.mp4", codec)
      expect(args).toEqual([
        "-y",
        "-i", "cap.mp4",
        "-i", "src.mp4",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "copy",
        "-shortest",
        "-movflags", "+faststart",
        "out.mp4",
      ])
    }
  })

  it("re-encodes any non-mp4-muxer-safe source audio to aac", () => {
    const args = buildAudioOntoVideoArgs("cap.mp4", "src.webm", "out.mp4", "opus")
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual(["-c:a", "aac"])
    expect(args).toContain("-shortest")
  })

  it("never re-encodes the video stream", () => {
    const args = buildAudioOntoVideoArgs("cap.mp4", "src.mp4", "out.mp4", "aac")
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"])
    // The captioned picture (input 0) is the video, the source (input 1) is the audio.
    expect(args.indexOf("-i") < args.lastIndexOf("-i")).toBe(true)
    expect(args).toContain("0:v:0")
    expect(args).toContain("1:a:0")
  })
})
