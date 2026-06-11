// apps/worker/src/sources/tender-gov-mn.ts
//
// Source adapter — user.tender.gov.mn/mn/invitation (public listing page, no auth).
//
// robots.txt: MUST verify https://user.tender.gov.mn/robots.txt before first live run.
// Rendering: JS — Playwright + Chromium.
// Rate limit: getRateLimiter("user.tender.gov.mn") — 1 req / 2 s ± 500 ms (subdomain-scoped).
// User-Agent: honest (TenderAlert/1.0). No spoofing, no rotation.

import { chromium } from "playwright";
import { getRateLimiter } from "@mn-platform/core";
import { normalizeText, parseMnDate, parseMnt } from "@mn-platform/mn";
import type { Source, TenderRecord } from "@mn-platform/core";
import { TenderRecordSchema, tenderContentHash } from "./tender-schema.js";

// ── raw shape scraped from the DOM ───────────────────────────────────────────

interface RawTender {
  tenderNo: string;
  title: string;
  procuringEntity: string;
  category: string;
  estBudgetMnt: string;
  submissionDeadline: string;
  announceDate: string;
  bidSecurityMnt: string;
  aimag: string;
  status: string;
  /** Trailing path segment used as externalId fallback when tenderNo is absent. */
  detailPath: string;
}

// ── constants ────────────────────────────────────────────────────────────────

const SOURCE_ID  = "tender.gov.mn";
const LIST_URL   = "https://user.tender.gov.mn/mn/invitation";
const USER_AGENT = "TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)";

// Rate limiter keyed on the subdomain being hit (not source_id).
const limiter = getRateLimiter("user.tender.gov.mn");

/**
 * DOM selectors — update this block after a single browser-devtools session on
 * https://user.tender.gov.mn/mn/invitation. All TODOs are co-located here so
 * one inspect pass wires the adapter completely.
 */
const SEL = {
  ROW:         "table tbody tr",                        // TODO: verify after live inspect
  TENDER_NO:   "td:nth-child(1)",                       // TODO: adjust column indices
  TITLE:       "td:nth-child(2)",
  ENTITY:      "td:nth-child(3)",
  CATEGORY:    "td:nth-child(4)",
  BUDGET:      "td:nth-child(5)",
  DEADLINE:    "td:nth-child(6)",
  ANNOUNCE:    "td:nth-child(7)",
  BID_SEC:     "td:nth-child(8)",
  AIMAG:       "td:nth-child(9)",
  STATUS:      "td:nth-child(10)",
  DETAIL_LINK: "a[href]",
  NEXT_PAGE:   ".pagination .next:not(.disabled)",      // TODO: verify pagination pattern
} as const;

// ── DOM extraction (runs inside browser via $$eval) ──────────────────────────
// Must be a self-contained function — no outer-scope references.
// Playwright serialises this function body into the page context.
// Column indices match SEL.TENDER_NO etc; update both together after inspect.

function extractRows(els: Element[]): RawTender[] {
  return els.map((el) => {
    const cell = (n: number) =>
      el.querySelector(`td:nth-child(${n})`)?.textContent?.trim() ?? "";
    const link = el.querySelector("a[href]");

    return {
      tenderNo:           cell(1),   // TODO: adjust after live inspect
      title:              cell(2),
      procuringEntity:    cell(3),
      category:           cell(4),
      estBudgetMnt:       cell(5),
      submissionDeadline: cell(6),
      announceDate:       cell(7),
      bidSecurityMnt:     cell(8),
      aimag:              cell(9),
      status:             cell(10),
      detailPath:         link?.getAttribute("href") ?? "",
    };
  });
}

// ── source implementation ────────────────────────────────────────────────────

export const tenderGovMnSource: Source<RawTender, TenderRecord> = {
  id: SOURCE_ID,

  async fetchPage(cursor) {
    const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;

    await limiter.acquire();

    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent:  USER_AGENT,
        locale:     "mn-MN",
        timezoneId: "Asia/Ulaanbaatar",
        viewport:   { width: 1280, height: 800 },
        extraHTTPHeaders: {
          "Accept-Language": "mn-MN,mn;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
      const page = await ctx.newPage();

      await page.goto(`${LIST_URL}?page=${pageNum}`, {
        waitUntil: "networkidle",
        timeout:   30_000,
      });

      await page.waitForSelector(SEL.ROW, { timeout: 15_000 });

      // Randomised post-load delay — reduces burst pressure; allows lazy content to settle.
      await page.waitForTimeout(1_000 + Math.random() * 2_000);

      // extractRows is passed directly — it is serialised into the page context by
      // Playwright. It must remain self-contained (no outer-scope references).
      const raw = await page.$$eval(SEL.ROW, extractRows);

      const hasNext = (await page.$(SEL.NEXT_PAGE)) !== null;

      return {
        raw,
        ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}),
      };
    } finally {
      await browser.close();
    }
  },

  parse(raw) {
    const tenderNo = raw.tenderNo ? normalizeText(raw.tenderNo) : null;
    const detailSlug =
      raw.detailPath.split("/").filter(Boolean).pop() ?? "";
    const externalId = tenderNo ?? detailSlug;

    if (!externalId) {
      throw new Error(
        `tender.gov.mn: cannot derive externalId — tenderNo empty and no detailPath. Row: ${JSON.stringify(raw)}`,
      );
    }

    return {
      externalId,
      tenderNo,
      procuringEntity:    raw.procuringEntity ? normalizeText(raw.procuringEntity) : null,
      category:           raw.category ? normalizeText(raw.category) : null,
      estBudgetMnt:       raw.estBudgetMnt ? parseMnt(raw.estBudgetMnt) : null,
      announceDate:       raw.announceDate ? parseMnDate(raw.announceDate) : null,
      submissionDeadline: raw.submissionDeadline ? parseMnDate(raw.submissionDeadline) : null,
      bidSecurityMnt:     raw.bidSecurityMnt ? parseMnt(raw.bidSecurityMnt) : null,
      aimag:              raw.aimag ? normalizeText(raw.aimag) : null,
      status:             raw.status ? normalizeText(raw.status) : "announced",
      fetchedVia:         "playwright",
      raw:                raw as unknown as Record<string, unknown>,
    };
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
