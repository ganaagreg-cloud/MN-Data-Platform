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
// "year=allYear&get=1" is required: the bare /mn/invitation page defaults to
// the server's current year, which returns zero rows ("Тохирох үр дүн
// олдсонгүй") on this site. Verified live 2026-06-14.
const LIST_URL   = "https://user.tender.gov.mn/mn/invitation?year=allYear&get=1";
const USER_AGENT = "TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)";

// Rate limiter keyed on the subdomain being hit (not source_id).
const limiter = getRateLimiter("user.tender.gov.mn");

// Verified against live rendered DOM 2026-06-14 for
// https://user.tender.gov.mn/mn/invitation?year=allYear&get=1.
const SEL = {
  ROW:              ".tender-result-table table tbody tr",
  TITLE:            "a.tender-name",
  PROCURING_ENTITY: ".client-name a",
  STATUS:           ".view-status .days-left:not(.budget)",
  BUDGET:           ".view-status .days-left.budget",
  TENDER_NO:        ".invitation-number .number",
  ANNOUNCE_DATE:    ".recieve-date .date",
  DEADLINE_TIME:    "time[datetime]",
  NEXT_PAGE:        ".pagination li:last-child a:not(.disabled)",
} as const;

// ── HTML extraction (cheerio) ─────────────────────────────────────────────────

export function extractRows($: CheerioAPI): RawTender[] {
  const rows: RawTender[] = [];
  $(SEL.ROW).each((_i, el) => {
    const $el    = $(el);
    const $title = $el.find(SEL.TITLE).first();
    // Skip the "Тохирох үр дүн олдсонгүй" (no results) placeholder row —
    // it has no .tender-name and would otherwise fail externalId derivation.
    if ($title.length === 0) return;

    const $deadline    = $el.find(SEL.DEADLINE_TIME).first();
    const deadlineDate = $deadline.attr("datetime") ?? "";
    const deadlineTime = $deadline.find("em").first().text().trim();

    rows.push({
      // .invitation-number/.recieve-date/.tender-name are each duplicated
      // (mobile + desktop layout) — .first() picks either copy.
      tenderNo:           $el.find(SEL.TENDER_NO).first().text().trim(),
      title:              $title.text().trim(),
      procuringEntity:    $el.find(SEL.PROCURING_ENTITY).first().text().trim(),
      category:           "",
      estBudgetMnt:       $el.find(SEL.BUDGET).first().text().trim(),
      submissionDeadline: `${deadlineDate} ${deadlineTime}`.trim(),
      announceDate:       $el.find(SEL.ANNOUNCE_DATE).first().text().trim(),
      bidSecurityMnt:     "",
      aimag:              "",
      status:             $el.find(SEL.STATUS).first().text().trim(),
      detailPath:         $title.attr("href") ?? "",
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

  // Any "&page=" param (even "&page=1") makes the bootstrap search return
  // zero rows — page 1 must be fetched via the bare LIST_URL. Later pages
  // resolve to the empty-result placeholder (skipped in extractRows) with
  // both pagination links disabled, so the pipeline terminates cleanly.
  const pageUrl = pageNum === 1 ? LIST_URL : `${LIST_URL}&page=${pageNum}`;
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
