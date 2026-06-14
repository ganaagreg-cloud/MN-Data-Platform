// packages/core/src/crawlbase.ts
import { CrawlingAPI } from "crawlbase";

export interface FetchRenderedHtmlOptions {
  /** Extra ms Crawlbase's headless browser waits after load before returning HTML. */
  pageWaitMs?: number;
  /** Forwarded to the target site as the User-Agent header. */
  userAgent?: string;
}

/** The subset of CrawlingAPI's response shape this module relies on. */
interface CrawlbaseResponse {
  statusCode: number;
  body: string;
}

/**
 * Fetches a JS-rendered page via the Crawlbase Crawling API and returns the
 * rendered HTML. Requires CRAWLBASE_TOKEN in the environment.
 */
export async function fetchRenderedHtml(
  url: string,
  options: FetchRenderedHtmlOptions = {},
): Promise<string> {
  const token = process.env["CRAWLBASE_TOKEN"];
  if (!token) {
    throw new Error("Missing required environment variable: CRAWLBASE_TOKEN");
  }

  const api = new CrawlingAPI({ token });
  const response = (await api.get(url, {
    ...(options.pageWaitMs !== undefined ? { page_wait: options.pageWaitMs } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
  })) as CrawlbaseResponse;

  if (response.statusCode !== 200) {
    throw new Error(`Crawlbase request failed for ${url}: status ${response.statusCode}`);
  }

  return response.body;
}
