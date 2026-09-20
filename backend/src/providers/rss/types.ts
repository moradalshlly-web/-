/**
 * One feed item as the Web Scrape RSS actor emits it.
 *
 * A PUBLIC wire contract — the docs, the MCP verb and the SDK all describe
 * exactly these five fields, for RSS and Atom alike. Add or rename nothing.
 */
export interface RssItem {
  title: string
  url: string
  description: string
  pubDate: string
  guid: string
}
