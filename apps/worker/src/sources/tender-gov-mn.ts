/**
 * Source adapter for tender.gov.mn (Цахим худалдан авах ажиллагаа).
 *
 * robots.txt: User-agent: * Allow: /  (all paths permitted for non-AI bots)
 * Rendering: JS — uses Playwright + chromium.
 * Rate limit: 1 req / 2 s with ±500 ms jitter (getRateLimiter default).
 *
 * TODO before first live run:
 *   1. Open https://tender.gov.mn/mn/tender/list in a browser, inspect the DOM.
 *   2. Replace ROW_SELECTOR and the field selectors in extractRows() below.
 *   3. Check whether pagination uses a query-param page number or a "next" button href.
 */

import { chromium } from "playwright";
import { z } from "zod";
import { getRateLimiter, sha256 } from "@mn-platform/core";
import type { Source, TenderRecord } from "@mn-platform/core";
import { normalizeText, parseMnDate, parseMnt } from "@mn-platform/mn";

// ── raw shape off the DOM ────────────────────────────────────────────────────

interface RawTender {
  tenderNo: string;
  procuringEntity: string;
  category: string;
  estBudgetMnt: string;
  announceDate: string;
  submissionDeadline: string;
  bidSecurityMnt: string;
  aimag: string;
  status: string;
  /** Used as externalId fallback when tenderNo is absent. */
  detailPath: string;
}

// ── Zod schema (validates parse() output before touching the DB) ─────────────

const TenderRecordSchema = z.object({
  externalId: z.string().min(1),
  tenderNo: z.string().nullable(),
  procuringEntity: z.string().nullable(),
  category: z.string().nullable(),
  estBudgetMnt: z.string().nullable(),
  announceDate: z.date().nullable(),
  submissionDeadline: z.date().nullable(),
  bidSecurityMnt: z.string().nullable(),
  aimag: z.string().nullable(),
  status: z.string(),
  raw: z.record(z.string(), z.unknown()),
});

// ── constants ────────────────────────────────────────────────────────────────

const SOURCE_ID = "tender.gov.mn";
const LIST_URL = "https://tender.gov.mn/mn/tender/list";
const USER_AGENT =
  "TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)";

// TODO: Replace with the actual CSS selector that matches one tender row.
// e.g. "table.tender-table tbody tr" or ".tender-card"
const ROW_SELECTOR = "table tbody tr";

const limiter = getRateLimiter(SOURCE_ID);

// ── DOM extraction (runs inside the browser via $$eval) ──────────────────────

function extractRows(els: Element[]): RawTender[] {
  return els.map((el) => {
    const cell = (n: number) =>
      el.querySelector(`td:nth-child(${n})`)?.textContent?.trim() ?? "";
    const link = el.querySelector("a[href]");

    return {
      // TODO: Adjust column indices to match the actual table layout.
      tenderNo: cell(1),
      procuringEntity: cell(2),
      category: cell(3),
      estBudgetMnt: cell(4),
      announceDate: cell(5),
      submissionDeadline: cell(6),
      bidSecurityMnt: cell(7),
      aimag: cell(8),
      status: cell(9),
      detailPath: link?.getAttribute("href") ?? "",
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
        userAgent: USER_AGENT,
        locale: "mn-MN",
      });
      const page = await ctx.newPage();

      await page.goto(`${LIST_URL}?page=${pageNum}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });

      // Wait for at least one row to appear.
      await page.waitForSelector(ROW_SELECTOR, { timeout: 15_000 });

      const raw = await page.$$eval(ROW_SELECTOR, extractRows);

      // TODO: Adjust the "has next page" detection to match the actual pagination.
      // Common patterns: disabled "next" button, absence of the button, or
      // the current page number equalling the last-page number shown.
      const hasNext =
        (await page.$(".pagination .next:not(.disabled)")) !== null ||
        (await page.$("[data-page-next]:not([disabled])")) !== null;

      return {
        raw,
        ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}),
      };
    } finally {
      await browser.close();
    }
  },

  parse(raw) {
    const externalId = raw.tenderNo
      ? normalizeText(raw.tenderNo)
      : raw.detailPath.split("/").filter(Boolean).pop() ?? "";

    if (!externalId) {
      throw new Error(
        `tender.gov.mn: cannot derive externalId — tenderNo empty and no detailPath. Row: ${JSON.stringify(raw)}`,
      );
    }

    return {
      externalId,
      tenderNo: raw.tenderNo ? normalizeText(raw.tenderNo) : null,
      procuringEntity: raw.procuringEntity
        ? normalizeText(raw.procuringEntity)
        : null,
      category: raw.category ? normalizeText(raw.category) : null,
      estBudgetMnt: raw.estBudgetMnt ? parseMnt(raw.estBudgetMnt) : null,
      announceDate: raw.announceDate ? parseMnDate(raw.announceDate) : null,
      submissionDeadline: raw.submissionDeadline
        ? parseMnDate(raw.submissionDeadline)
        : null,
      bidSecurityMnt: raw.bidSecurityMnt ? parseMnt(raw.bidSecurityMnt) : null,
      aimag: raw.aimag ? normalizeText(raw.aimag) : null,
      status: raw.status ? normalizeText(raw.status) : "announced",
      raw: raw as unknown as Record<string, unknown>,
    };
  },

  schema: TenderRecordSchema,

  contentHash(r) {
    // Hash canonical business fields only — never include scrape timestamps.
    const canonical = [
      r.tenderNo ?? "",
      r.procuringEntity ?? "",
      r.submissionDeadline?.toISOString() ?? "",
      r.estBudgetMnt ?? "",
      r.status,
    ].join("|");
    return sha256(canonical);
  },
};
