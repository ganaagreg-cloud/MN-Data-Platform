# Crawlbase Adapter Swap — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Goal

Replace the Playwright/Chromium-based `fetchPage` implementations in `unegui-mn.ts` and
`tender-gov-mn.ts` with calls to the Crawlbase Crawling API (JS-rendering token), parsing
the returned HTML with `cheerio`. `getRateLimiter`, the `Source` interface, `parseListing`,
`filter`, and `contentHash` are unchanged. This removes the `playwright` dependency, the
Dockerfile's Chromium system deps, and the Playwright-specific Sentry filter entirely.

**Why switch:** smaller worker image (no Chromium + system libs), offloads anti-bot/JS
rendering to a managed service, removes flaky Playwright navigation-timeout failures.

---

## Verified APIs (Context7, 2026-06-14)

- `crawlbase` npm package, v1.0.2, ships its own `index.d.ts` (no `@types/crawlbase` needed).
  ```ts
  const api = new CrawlingAPI({ token: "YOUR_JS_TOKEN" });
  const response = await api.get(url, { page_wait: 3000, userAgent: "..." });
  // response.statusCode, response.body (rendered HTML string)
  ```
- `cheerio` npm package, v1.2.0, ESM (`import * as cheerio from "cheerio"`).
  `cheerio.load(html)` → `$`; `$(selector).each((i, el) => ...)`; `$(el).find(sel).first().text()`;
  `.attr("href")`; `:nth-child(n)` supported.

---

## File Layout

```
packages/core/package.json              ← add dependency: crawlbase ^1.0.2
packages/core/src/crawlbase.ts           ← NEW: fetchRenderedHtml(url, options)
packages/core/src/crawlbase.test.ts      ← NEW: token-missing / non-200 throw tests
packages/core/src/index.ts               ← export fetchRenderedHtml, FetchRenderedHtmlOptions
packages/core/src/types.ts               ← fetchedVia doc comment: "playwright" → "crawlbase"

apps/worker/package.json                 ← remove playwright; add cheerio ^1.2.0
apps/worker/src/env.ts                   ← add CRAWLBASE_TOKEN: z.string().min(1)
apps/worker/src/env.test.ts              ← add CRAWLBASE_TOKEN cases (ENV_KEYS, setValidEnv)
apps/worker/src/sources/selector-guard.ts        ← NEW: selectorPresent($, selector, url, ctx)
apps/worker/src/sources/selector-guard.test.ts   ← NEW
apps/worker/src/sources/unegui-mn.ts             ← fetchPage → Crawlbase+cheerio; checkListingContainer
                                                     becomes sync, uses selectorPresent
apps/worker/src/sources/unegui-mn.test.ts        ← rewrite checkListingContainer tests for cheerio
apps/worker/src/sources/tender-gov-mn.ts         ← fetchPage → Crawlbase+cheerio; NEW checkRowContainer
                                                     via selectorPresent; fetchedVia: "crawlbase"
apps/worker/src/sources/tender-gov-mn.test.ts    ← NEW: checkRowContainer tests
apps/worker/src/scheduler.ts             ← TenderAdapter "playwright"|"api" → "scrape"|"api";
                                             TENDER_ADAPTER default "scrape"
apps/worker/src/sentry-filters.ts        ← remove dropNavigationErrors (no more NavigationError)
apps/worker/src/sentry-filters.test.ts   ← remove (file becomes empty / delete)
apps/worker/src/instrument.ts            ← drop beforeSend + dropNavigationErrors import
apps/worker/Dockerfile                   ← remove Chromium system-deps block

.env.example                             ← add CRAWLBASE_TOKEN=

CLAUDE.md                                ← Stack: Scraping line updated; Progress log entry
```

---

## 1. `packages/core/src/crawlbase.ts`

```ts
import { CrawlingAPI } from "crawlbase";

export interface FetchRenderedHtmlOptions {
  /** Extra ms Crawlbase's headless browser waits after load before returning HTML. */
  pageWaitMs?: number;
  /** Forwarded to the target site as the User-Agent header. */
  userAgent?: string;
}

export async function fetchRenderedHtml(
  url: string,
  options: FetchRenderedHtmlOptions = {},
): Promise<string> {
  const token = process.env["CRAWLBASE_TOKEN"];
  if (!token) {
    throw new Error("Missing required environment variable: CRAWLBASE_TOKEN");
  }

  const api = new CrawlingAPI({ token });
  const response = await api.get(url, {
    ...(options.pageWaitMs !== undefined ? { page_wait: options.pageWaitMs } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
  });

  if (response.statusCode !== 200) {
    throw new Error(`Crawlbase request failed for ${url}: status ${response.statusCode}`);
  }

  return response.body;
}
```

Exact option/response field names to be confirmed against the installed `crawlbase/index.d.ts`
during implementation (Context7 snippet may not be exhaustive).

---

## 2. `apps/worker/src/sources/selector-guard.ts`

```ts
import * as Sentry from "@sentry/node";
import type { CheerioAPI } from "cheerio";
import { logger } from "../logger.js";

export function selectorPresent(
  $: CheerioAPI,
  selector: string,
  url: string,
  ctx: { sourceLabel: string; message: string },
): boolean {
  if ($(selector).length > 0) return true;
  logger.warn({ url }, ctx.message);
  Sentry.captureMessage(`${ctx.sourceLabel} selector not found`, {
    level: "warning",
    extra: { url },
  });
  return false;
}
```

`unegui-mn.ts`'s `checkListingContainer($, url)` and `tender-gov-mn.ts`'s new
`checkRowContainer($, url)` both delegate to this, preserving their existing
exported names/messages (`"Unegui selector not found"` / `"Tender selector not found"`,
`"listing container not found — selector may have changed"` /
`"tender row container not found — selector may have changed"`).

---

## 3. `unegui-mn.ts` fetchPage

```ts
async function fetchListingPage(url, cursor) {
  const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;
  await limiter.acquire();

  const pageUrl = `${url}?page=${pageNum}`;
  const html = await fetchRenderedHtml(pageUrl, { pageWaitMs: 3000, userAgent: USER_AGENT });
  const $ = cheerio.load(html);

  if (!checkListingContainer($, pageUrl)) {
    return { raw: [] };
  }

  const raw = extractRows($);
  const hasNext = $(SEL.NEXT_PAGE).length > 0;
  return { raw, ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}) };
}
```

`extractRows($: CheerioAPI): RawListing[]` iterates `$(SEL.CARD).each(...)`, same field
selectors/TODOs as today, using `$el.find(sel).first().text().trim()`.

`PageLike` interface removed. `checkListingContainer` becomes synchronous.

---

## 4. `tender-gov-mn.ts` fetchPage

Same pattern, own `LIST_URL`/`SEL`/`limiter`. New `checkRowContainer($, url)` guard before
`extractRows`; on failure returns `{ raw: [] }` (previously an unguarded
`waitForSelector` timeout would throw). `fetchedVia: "crawlbase"`.

---

## 5. Env / config

- `apps/worker/src/env.ts`: `CRAWLBASE_TOKEN: z.string().min(1)`.
- `.env.example`: add `CRAWLBASE_TOKEN=`.
- A real token must be added to the local `.env` before `pnpm dev`/deploy will boot
  (not supplied by this change).

---

## 6. `scheduler.ts` — TENDER_ADAPTER rename

```ts
type TenderAdapter = "scrape" | "api";
const raw = process.env["TENDER_ADAPTER"] ?? "scrape";
if (raw !== "scrape" && raw !== "api") {
  throw new Error(`TENDER_ADAPTER must be "scrape" or "api", got "${raw}"`);
}
...
const source = adapter === "scrape" ? tenderGovMnSource : openDataTenderSource;
```

---

## 7. Cleanup

- `apps/worker/package.json`: remove `playwright`, add `cheerio: ^1.2.0`.
- `apps/worker/Dockerfile`: remove the Chromium system-deps `apt-get install` block and its comments.
- `apps/worker/src/sentry-filters.ts` + `.test.ts`: delete `dropNavigationErrors` (file removed
  if nothing else remains).
- `apps/worker/src/instrument.ts`: drop `beforeSend: dropNavigationErrors` and the import.
- `packages/core/src/types.ts`: `fetchedVia` doc comment → `("crawlbase" | "api" | future)`.

---

## 8. Tests

- `packages/core/src/crawlbase.test.ts`: throws when `CRAWLBASE_TOKEN` unset; throws on
  non-200; returns `body` on 200 (mock `crawlbase`'s `CrawlingAPI`).
- `selector-guard.test.ts`: true when selector present; false + logger.warn + Sentry.captureMessage
  when absent.
- `unegui-mn.test.ts`: `checkListingContainer` tests rewritten with `cheerio.load(...)` fixtures,
  synchronous (no `await`).
- `tender-gov-mn.test.ts` (new): `checkRowContainer` tests, same shape.
- `env.test.ts`: add `CRAWLBASE_TOKEN` to `ENV_KEYS`/`setValidEnv`, plus a "throws when missing" case.

---

## 9. Docs

- `CLAUDE.md` Stack → Scraping line: Crawlbase Crawling API (JS rendering) + cheerio for
  unegui.mn and tender.gov.mn; `undici` fetch for static; one `RateLimiter` per domain.
- `CLAUDE.md` Progress log: new entry once implemented.
