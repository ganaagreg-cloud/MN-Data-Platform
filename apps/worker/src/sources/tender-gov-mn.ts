// apps/worker/src/sources/tender-gov-mn.ts
//
// Source adapter — user.tender.gov.mn/mn/invitation (public listing page, no auth).
//
// robots.txt: MUST verify https://user.tender.gov.mn/robots.txt before first live run.
// Rendering: JS — Crawlbase Crawling API (rendered HTML) + cheerio.
// Rate limit: getRateLimiter("user.tender.gov.mn") — 1 req / 2 s ± 500 ms (subdomain-scoped).
// User-Agent: honest (TenderAlert/1.0). No spoofing, no rotation.

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { fetchRenderedHtml, getRateLimiter } from "@mn-platform/core";
import { normalizeText, parseMnDate, parseMnt } from "@mn-platform/mn";
import type { Source, TenderRecord } from "@mn-platform/core";
import { TenderRecordSchema, tenderContentHash } from "./tender-schema.js";
import { selectorPresent } from "./selector-guard.js";

// ── raw shape scraped from the page ──────────────────────────────────────────

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
 * CSS selectors — update this block after a single browser-devtools session on
 * https://user.tender.gov.mn/mn/invitation. All TODOs are co-located here so
 * one inspect pass wires the adapter completely.
 */
const SEL = {
  ROW:         "table tbody tr",                        // TODO: verify after live inspect
  DETAIL_LINK: "a[href]",
  NEXT_PAGE:   ".pagination .next:not(.disabled)",      // TODO: verify pagination pattern
} as const;

// ── HTML extraction (cheerio) ─────────────────────────────────────────────────
// Column indices below are 1-based td:nth-child positions; update both the
// indices and the TODO comments together after inspect.

function extractRows($: CheerioAPI): RawTender[] {
  const rows: RawTender[] = [];
  $(SEL.ROW).each((_i, el) => {
    const $el = $(el);
    const cell = (n: number) => $el.find(`td:nth-child(${n})`).first().text().trim();

    rows.push({
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
      detailPath:         $el.find(SEL.DETAIL_LINK).first().attr("href") ?? "",
    });
  });
  return rows;
}

// ── selector-drift guard ────────────────────────────────────────────────────
// A missing row selector usually means the site's markup changed, not that
// there are zero tenders — report it and degrade to "0 tenders this page" so
// fetchPage() can continue rather than failing the whole job.

export function checkRowContainer($: CheerioAPI, url: string): boolean {
  return selectorPresent($, SEL.ROW, url, {
    sourceLabel: "Tender",
    message: "tender row container not found — selector may have changed",
  });
}

// ── fetchPage ─────────────────────────────────────────────────────────────────

async function fetchTenderPage(cursor?: string): Promise<{ raw: RawTender[]; nextCursor?: string }> {
  const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;
  await limiter.acquire();

  const pageUrl = `${LIST_URL}?page=${pageNum}`;
  const html = await fetchRenderedHtml(pageUrl, { pageWaitMs: 3_000, userAgent: USER_AGENT });
  const $ = cheerio.load(html);

  if (!checkRowContainer($, pageUrl)) {
    return { raw: [] };
  }

  const raw     = extractRows($);
  const hasNext = $(SEL.NEXT_PAGE).length > 0;

  return { raw, ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}) };
}

// ── source implementation ────────────────────────────────────────────────────

export const tenderGovMnSource: Source<RawTender, TenderRecord> = {
  id: SOURCE_ID,

  fetchPage: fetchTenderPage,

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
      fetchedVia:         "crawlbase",
      raw:                raw as unknown as Record<string, unknown>,
    };
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
