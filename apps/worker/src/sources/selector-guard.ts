// apps/worker/src/sources/selector-guard.ts
//
// Shared selector-drift guard for cheerio-based adapters. A missing container
// selector usually means the site's markup changed, not that there are zero
// results — report it and let the caller degrade to "0 rows this page"
// instead of throwing and failing the whole scrape job.

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
