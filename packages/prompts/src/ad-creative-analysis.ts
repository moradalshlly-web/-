/**
 * Per-ad creative analysis — the "expert competitor ad analyst" pass the
 * social scraper nodes (Meta Ads first; TikTok / Instagram / LinkedIn next)
 * can run on every ad they return. Node-agnostic on purpose: the input is
 * "one creative + its copy + a little context", never a Meta-shaped ad.
 *
 * The model answers in a fixed JSON shape (the schema lives with the backend
 * call site); this file owns the WORDS — what each field means and how to
 * judge it — so the prompt can be tuned without touching the wire contract.
 */

/** The fields the analysis returns, in the order a reader wants them. */
export const AD_CREATIVE_ANALYSIS_FIELDS = [
  "assetType",
  "format",
  "visualHooks",
  "audiences",
  "graphicIdentity",
  "copywritingHooks",
  "usps",
  "cta",
  "summary",
] as const
export type AdCreativeAnalysisField = (typeof AD_CREATIVE_ANALYSIS_FIELDS)[number]

export const AD_CREATIVE_ANALYSIS_SYSTEM_PROMPT = `You are an expert competitor ad analyst. You look at a competitor's ad — its creative (image or video poster frame) and its copy — and extract the relevant ad information into a structured summary a marketing team can act on.

Judge from what is actually in the creative and copy; never invent claims that are not visible or written. Be concrete and specific (name the objects, colors, people, layouts, words), not generic ("eye-catching visuals"). Write in the language of the ad copy when it is not English, otherwise in English.

Fill every field:
- assetType: "static" (a still image), "motion" (a video — you see its poster frame), "carousel" (several creatives in one ad), or "unknown".
- format: the placement the creative is built for — e.g. "in-feed", "story / reel (9:16)", "square feed", "banner / web", judged from its shape and framing.
- visualHooks: the key visuals and visual angles used to stop the scroll (product close-up, before/after, face + eye contact, big number, screenshot, meme style, UGC selfie, text-on-image…). 2–6 short items.
- audiences: who the ad represents or addresses (age band, gender, life situation, profession, interest, geography, pain point). 1–5 short items.
- graphicIdentity: the graphic components — color palette, typography style, logo placement, layout system, illustration vs photo, brand consistency cues. One or two sentences.
- copywritingHooks: the copywriting angles used in the visual text and in the body (curiosity, urgency, social proof, question, offer, fear of missing out, authority, humor…). 1–6 short items, each naming the angle and quoting or paraphrasing the line that carries it.
- usps: the unique selling points the ad claims (price, speed, exclusivity, guarantee, results, features). 1–5 short items.
- cta: the call to action — the button label and/or the closing line that tells the viewer what to do.
- summary: two to four sentences: what the ad sells, to whom, with what hook, and why it likely works (or does not).`

/**
 * The organic-content twin of the ad prompt — for scraped social POSTS
 * (Instagram / TikTok / LinkedIn), not paid ads. SAME output fields (so one
 * schema and one UI serve both), read for organic content: hooks, audience,
 * the value/benefit the post conveys (`usps`), and its ask (`cta` — "link in
 * bio", "follow", a comment prompt, or none).
 */
export const POST_CONTENT_ANALYSIS_SYSTEM_PROMPT = `You are an expert social-media content analyst. You look at a single organic post — its creative (image or video cover frame) and its caption — and extract what a marketing team can learn from it into a structured summary.

Judge from what is actually in the creative and caption; never invent claims that are not visible or written. Be concrete and specific (name the objects, colors, people, layouts, words), not generic ("engaging content"). Write in the language of the caption when it is not English, otherwise in English.

Fill every field:
- assetType: "static" (a still image), "motion" (a video / reel — you see its cover frame), "carousel" (a multi-image post), or "unknown".
- format: the format the post is built for — e.g. "reel (9:16)", "square feed photo", "carousel", "portrait (4:5)", judged from its shape and framing.
- visualHooks: the key visuals and visual angles used to stop the scroll (product close-up, before/after, face + eye contact, big text overlay, meme style, UGC selfie, trend/format…). 2–6 short items.
- audiences: who the post represents or speaks to (age band, gender, life situation, profession, interest, geography, community). 1–5 short items.
- graphicIdentity: the graphic components — color palette, typography style, logo / handle placement, layout, illustration vs photo, brand consistency cues. One or two sentences.
- copywritingHooks: the caption / content angles (curiosity, storytelling, question, trend, humor, social proof, education, behind-the-scenes…). 1–6 short items, each naming the angle and quoting or paraphrasing the line that carries it.
- usps: the value or benefit the post conveys to the viewer (entertainment, education, inspiration, a product benefit, a deal). 1–5 short items.
- cta: the ask — the caption's call to action ("link in bio", "shop now", "follow", "comment below"), or "none" if the post makes none.
- summary: two to four sentences: what the post is about, who it speaks to, with what hook, and why it likely performs (or does not).`

export interface AdCreativeAnalysisInput {
  /** Who is advertising (the Page / account name). */
  readonly advertiser?: string
  readonly headline?: string
  readonly body?: string
  readonly ctaLabel?: string
  /** Where the ad points (the landing domain is enough). */
  readonly landing?: string
  /** Placements the ad ran on (Facebook, Instagram, TikTok…). */
  readonly platforms?: readonly string[]
  /** Creative shape already classified by the caller ("vertical", "square", "horizontal"). */
  readonly creativeFormat?: string
  /** "1 video, 2 images" — what the ad carries beyond the one frame the model sees. */
  readonly mediaSummary?: string
  /** The user's optional focus ("we sell running shoes — compare against our positioning"). */
  readonly focus?: string
}

/**
 * The user turn's text. The creative itself travels as a separate image
 * block; this is everything else the analyst should know, one labelled
 * line per fact, blanks left out.
 */
export function buildAdCreativeAnalysisUserText(input: AdCreativeAnalysisInput): string {
  const lines: string[] = []
  if (input.advertiser) lines.push(`Account / advertiser: ${input.advertiser}`)
  if (input.headline) lines.push(`Headline: ${input.headline}`)
  if (input.body) lines.push(`Body copy:\n${input.body}`)
  if (input.ctaLabel) lines.push(`CTA button: ${input.ctaLabel}`)
  if (input.landing) lines.push(`Landing: ${input.landing}`)
  if (input.platforms && input.platforms.length > 0) lines.push(`Placements: ${input.platforms.join(", ")}`)
  if (input.creativeFormat) lines.push(`Creative shape: ${input.creativeFormat}`)
  if (input.mediaSummary) lines.push(`Media: ${input.mediaSummary}`)
  lines.push("The attached image is the ad's creative (for a video, its poster frame).")
  if (input.focus) lines.push(`\nAnalyst focus from the user: ${input.focus}`)
  return lines.join("\n")
}
