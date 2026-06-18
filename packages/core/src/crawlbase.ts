// packages/core/src/crawlbase.ts

export interface FetchRenderedHtmlOptions {
  /** Extra ms Crawlbase's headless browser waits after load before returning HTML. */
  pageWaitMs?: number;
  /** Forwarded to the target site as the User-Agent header. */
  userAgent?: string;
}

/**
 * Fetches a JS-rendered page via the Crawlbase Crawling API and returns the
 * rendered HTML. Requires CRAWLBASE_TOKEN in the environment.
 *
 * Uses native fetch instead of the crawlbase npm package to avoid the package's
 * 90-second hard timeout (pages with long page_wait values can exceed it).
 */
export async function fetchRenderedHtml(
  url: string,
  options: FetchRenderedHtmlOptions = {},
): Promise<string> {
  const token = process.env["CRAWLBASE_TOKEN"];
  if (!token) {
    throw new Error("Missing required environment variable: CRAWLBASE_TOKEN");
  }

  const params = new URLSearchParams({ token, url, ajax_wait: "true" });
  if (options.pageWaitMs !== undefined) {
    params.set("page_wait", String(options.pageWaitMs));
  }
  if (options.userAgent !== undefined) {
    params.set("user_agent", options.userAgent);
  }

  const apiUrl = `https://api.crawlbase.com/?${params.toString()}`;
  const response = await fetch(apiUrl);
  const body = await response.text();

  const originalStatus = response.headers.get("original_status");
  const statusCode = originalStatus ? Number(originalStatus) : response.status;

  if (statusCode !== 200) {
    throw new Error(`Crawlbase request failed for ${url}: status ${statusCode}`);
  }

  return body;
}
