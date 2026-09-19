# Web Scrape

> Fetch data from web pages, Google Search, Instagram, TikTok, or RSS feeds and emit structured JSON.

## Overview

The Web Scrape node retrieves data from external sources using configurable actors (scrapers). Choose from Google Search for keyword results, a content crawler for page or site Markdown, RSS for feed items, or Instagram/TikTok for post metadata. Output is a structured JSON array that you can pipe into Extract Field, JSON Process, or a List node for fan-out.

## When to Use

- Pull search results into a content generation pipeline
- Scrape a web page and feed its text to Generate Text for summarization
- Fetch recent Instagram or TikTok posts for analysis or remixing
- Combine with Schedule Trigger to run recurring data ingestion workflows

## Configuration

### Source (actor)

| Actor | Label | Description |
|-------|-------|-------------|
| `google-search` | Google Search | Returns up to 10 search-result items |
| `content-crawler` | Website Content (Markdown) | Crawls one page or an entire site; emits Markdown |
| `rss` | RSS Feed | Directly fetches and parses an RSS/Atom feed (no Apify) |
| `instagram` | Instagram | Retrieves posts from a profile or URL |
| `tiktok` | TikTok | Retrieves posts from a profile or URL |

### Google Search fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Query | text | — | Search query. Use `{}` to inject an upstream text value |
| Max results | number | 5 | How many results to return (1–10) |
| Country code | text | — | 2-letter ISO country code to localise results (e.g., `us`) |

### Website Content (Markdown) fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Start URL | text | — | Address of the page or site root, as typed in a browser: `https://` is optional, so `pletor.ai` and `www.pletor.ai/products` both work. Use `{}` to inject upstream |
| Crawl mode | select | `page` | `Single page` — one URL; `Site crawl, up to 20 pages` — follows internal links from the start URL. Each option shows its price |

### RSS fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Feed URL | text | — | Address of the RSS or Atom feed (`https://` optional) |
| Results limit | number | 10 | Maximum items to return (1–50). Emits `{ title, url, description, pubDate, guid }` per item |

### Instagram / TikTok fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Profile or post URL | text | — | Address of the profile or post, with or without `https://` (`instagram.com/nike` works). Use `{}` to inject upstream |
| Results limit | number | 10 | Maximum posts to return (1–20) |

## Results

After a run, the node card peeks at the first few items and the settings panel's **Results** tab lists them all (with a Raw JSON view, copy and download). Every item links to its source — the search result's page, the feed item, the crawled page, the Instagram post, the TikTok video — and opens in a new tab, so you can judge a result before building on it. Only `http`/`https` addresses become links; anything else a feed returns is shown as text.

## Inputs & Outputs

**Inputs:** Optional upstream connection (used when injecting a value into a field via `{}`).

**Outputs:** `json` — a structured JSON array of result items. Connect to Extract Field or JSON Process to reshape the data.

## Pricing

| SKU | Credits |
|-----|---------|
| Google Search | 30 CR |
| Content Crawler — single page | 10 CR |
| Content Crawler — site crawl | 50 CR |
| Instagram | 10 CR |
| TikTok | 10 CR |
| RSS | 10 CR |

The Run button on the node, the Run button in the panel, the price beside each crawl mode and the Execute-workflow total all show the same figure — the one your account is charged for that run.

A run that fails is refunded in full. A run that finds nothing is a completed run: it is charged, and the node keeps the last good result beside the empty outcome.

## Long crawls and the API

A site crawl follows up to 20 pages and routinely runs for several minutes — longer than the ~100-second limit on a single HTTP request. In the editor and in a workflow there is nothing to do: both ask for a job and wait for it, and the pages appear on the node when the crawl lands. Reopening a workflow after a crawl finished in the background shows its result too.

A direct API caller chooses how the answer comes back:

- **Job id first (use this for site crawls).** Send `"respondAsync": true` in the body. The route answers `{ "jobId": "…", "status": "pending" }` at once and finishes on the server; read the pages from the completed job's `output_data.json` (`GET /v1/jobs/:id`, or `client.jobs.get(jobId)` in the SDK).
- **Held response (the default).** Without the flag the request stays open until the scrape is done and the result comes back in the response body as `{ "jobId": "…", "json": … }`. Right for a single page, a search or a feed. A crawl that outlasts the request limit is cut off on the way back even though the job completes and is charged — its result is still on the job.

## Common Use Cases

- Search Google for a keyword, extract the top titles, and feed each into a Generate Text node for article drafts
- Crawl a product page and pipe its Markdown to an LLM for structured data extraction
- Pull the latest Instagram posts from a brand account and batch-generate captions for remixes
- Use RSS + Schedule Trigger to build a fully automated daily newsletter pipeline

## Tips

- All actor fields support FieldMapping injection via `{}` so you can drive the query or URL from an upstream Text node.
- For site crawls, the crawler follows internal links up to 20 pages; use `Single page` when you only need one URL's content.
- RSS items contain `title`, `url`, `description`, `pubDate`, and `guid`. Use Extract Field with `title` to pull just the headlines.
- Chain an Extract Field node after Web Scrape to pull a specific property (e.g., `caption` from TikTok, `title` from Google results) before feeding a List node.
