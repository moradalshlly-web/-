/**
 * Block Kit packing helpers shared by the daily digests.
 *
 * Slack caps a section's text at 3000 chars and a message at 50 blocks. On a
 * busy day one joined list would blow the first cap (→ 400 → the digest
 * retries every tick and never sends), so pack lines into multiple sections
 * within budget and fold any overflow past the block cap into a "…and N more".
 */
export const SLACK_SECTION_MAX = 2900
export const MAX_DIGEST_SECTIONS = 45

export function chunkForSlackSections(lines: string[]): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let curLen = 0
  for (const line of lines) {
    const addLen = curLen === 0 ? line.length : curLen + 1 + line.length
    if (addLen > SLACK_SECTION_MAX && cur.length > 0) {
      chunks.push(cur.join("\n"))
      cur = []
      curLen = 0
    }
    cur.push(line)
    curLen = curLen === 0 ? line.length : curLen + 1 + line.length
  }
  if (cur.length > 0) chunks.push(cur.join("\n"))
  if (chunks.length > MAX_DIGEST_SECTIONS) {
    const kept = chunks.slice(0, MAX_DIGEST_SECTIONS - 1)
    const droppedLines = chunks.slice(MAX_DIGEST_SECTIONS - 1).reduce((n, c) => n + c.split("\n").length, 0)
    kept.push(`…and ${droppedLines} more`)
    return kept
  }
  return chunks
}

/** One mrkdwn section block per packed chunk. */
export function sectionBlocks(lines: string[]): unknown[] {
  return chunkForSlackSections(lines).map((text) => ({ type: "section", text: { type: "mrkdwn", text } }))
}
