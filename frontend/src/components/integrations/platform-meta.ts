import type { SocialProviderInfo } from "@/lib/api"

/**
 * One-line descriptions for the known networks. These used to live inside
 * `platform-card.tsx`; the redesigned page also SEARCHES them, so they moved
 * out rather than being duplicated or reached for through the card.
 *
 * Pre-existing gap, deliberately not widened here: these are English strings
 * in a translated app. Translating twenty of them is its own change.
 */
const PLATFORM_DESCRIPTIONS: Readonly<Record<string, string>> = {
  instagram: "Post images, reels, and stories (uses Facebook Login)",
  "instagram-standalone": "Post images, reels, and stories — connects directly, no Facebook Page",
  tiktok: "Upload videos directly",
  youtube: "Upload videos and shorts",
  linkedin: "Share posts with text, images, or video",
  x: "Post tweets with media",
  facebook: "Post to your page",
  telegram: "Send messages to channels and chats",
  bluesky: "Post to the ATmosphere with images",
  devto: "Publish markdown articles",
  hashnode: "Publish to your Hashnode blog",
  medium: "Publish stories",
  wordpress: "Publish posts to your site",
  lemmy: "Post into your community",
  reddit: "Submit posts to subreddits",
  pinterest: "Pin images to your board",
  discord: "Send messages via your bot",
  twitch: "Send chat messages to your channel",
  threads: "Post text and images",
  mastodon: "Toot with images",
}

/**
 * A network the registry added but this map has not caught up with still gets
 * a sentence, derived from its declared media capabilities — the grid has
 * always been allowed to grow from the backend alone.
 */
export function describeProvider(provider: SocialProviderInfo): string {
  return PLATFORM_DESCRIPTIONS[provider.id] ?? `Publish ${provider.capabilities.media.join(", ")} content`
}

export { PLATFORM_DESCRIPTIONS }
