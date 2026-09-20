import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface AddCaptionsOptions {
  readonly videoUrl: string
  readonly text: string
  readonly position?: "bottom" | "top" | "center"
  readonly fontSize?: number
  readonly color?: string
  readonly style?: "subtitle" | "word-highlight" | "karaoke"
  readonly backgroundColor?: string
}

// Legacy anchors for the plain-text FFmpeg fast-path (drawtext). These differ
// from the Remotion caption anchors (CAPTION_EDGE_INSET {top:12%, bottom:18%})
// used by every styled/kinetic/segmented caption and any `position_y`: bottom
// here sits ~40 px off the frame edge (≈98%), not at 82%. Unifying the two needs
// a characterization re-bless of the add-captions goldens (the y-position is a
// measured decoded-output metric), so it is a deliberate follow-up rather than a
// drive-by change. Only a bare plain-text subtitle reaches this path — a caller
// who wants the exact/unified placement sets `position_y` (→ Remotion).
const POSITION_Y: Record<string, string> = {
  bottom: "h-th-40",
  top: "40",
  center: "(h-th)/2",
}

export async function addCaptions(options: AddCaptionsOptions): Promise<string> {
  const { videoUrl, text, position = "bottom", fontSize = 24, color = "#FFFFFF", style = "subtitle" } = options
  const workDir = await createWorkDir("add-captions")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[addCaptions] Downloading video`)
    await downloadFile(videoUrl, inputPath)

    const escapedText = text
      .replace(/\\/g, "\\\\\\\\")
      .replace(/'/g, "\u2019")
      .replace(/:/g, "\\:")
      .replace(/\n/g, "\\n")

    const fontColor = color.startsWith("#") ? color.replace("#", "0x") : color
    const yPos = POSITION_Y[position] ?? POSITION_Y.bottom

    let boxOpts = ""
    if (style === "word-highlight" || style === "karaoke") {
      boxOpts = ":box=1:boxcolor=black@0.7:boxborderw=8"
    }

    const vf = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${yPos}${boxOpts}`

    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-vf", vf,
      "-c:a", "copy",
      outputPath,
    ])

    console.log(`[addCaptions] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
