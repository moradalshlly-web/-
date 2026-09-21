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

// Unified with the Remotion caption anchors (CAPTION_EDGE_INSET {top:12%,
// bottom:18%} in packages/remotion/src/lib/overlay-position.ts) so `position`
// means the SAME thing whichever engine draws the caption: a top block's TOP
// edge sits at 12% of the height, a bottom block's BOTTOM edge 18% above the
// bottom (= 82% of the height), center is a true centre. (The characterization
// goldens for add-captions measure frame LUMA within ±1–2 %, which a moved
// caption does not disturb — verified with characterize:check — so an anchor
// change needs no re-bless.)
const POSITION_Y: Record<string, string> = {
  bottom: "h-h*0.18-th",
  top: "h*0.12",
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
