// apps/worker/src/sources/unegui-mn.ts
//
// Source adapter — unegui.mn apartment listings (sale + rent), UB only.
//
// robots.txt: MUST verify https://www.unegui.mn/robots.txt before first live run.
// Rendering: JS — Crawlbase Crawling API (rendered HTML) + cheerio.
// Rate limit: getRateLimiter("unegui.mn") — shared for both sale and rent (same domain).
// User-Agent: honest (GazarPrice/1.0). No spoofing, no rotation.
// Compliance: store structured fields only — no description text, photos, or copyrighted content.

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { fetchRenderedHtml, getRateLimiter } from "@mn-platform/core";
import { normalizeDistrict, normalizeText, parseMnt } from "@mn-platform/mn";
import type { Source, ListingRecord } from "@mn-platform/core";
import { ListingRecordSchema, listingContentHash } from "./listing-schema.js";
import { selectorPresent } from "./selector-guard.js";

// ── raw shape scraped from the page ───────────────────────────────────────────

interface RawListing {
  price:      string;
  rooms:      string;
  area:       string;
  floor:      string;
  district:   string;
  khoroo:     string;
  building:   string;
  detailPath: string;
}

// ── constants ─────────────────────────────────────────────────────────────────

const SOURCE_ID  = "unegui.mn";
const SALE_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-zarna/ulaanbaatar/";
const RENT_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-treej/ulaanbaatar/";
const USER_AGENT = "GazarPrice/1.0 (+https://gazarprice.mn; info@gazarprice.mn)";

// One token bucket for the entire unegui.mn domain — shared across sale and rent.
const limiter = getRateLimiter("unegui.mn");

/**
 * CSS selectors — update after a single browser-devtools session on
 * https://www.unegui.mn/l-hdlh/l-hdlh-zarna/ulaanbaatar/
 * All TODOs co-located so one inspect pass wires both adapters completely.
 */
const SEL = {
  CARD:      ".list-announcement-block",               // TODO: verify after live inspect
  NEXT_PAGE: ".pager__item--next:not(.disabled)",      // TODO: verify pagination pattern
} as const;

// ── HTML extraction (cheerio) ──────────────────────────────────────────────────
// Store only structured fields — never description text or image URLs.

function extractRows($: CheerioAPI): RawListing[] {
  const rows: RawListing[] = [];
  $(SEL.CARD).each((_i, el) => {
    const $el = $(el);
    const text = (sel: string) => $el.find(sel).first().text().trim();
    rows.push({
      price:      text(".price-title"),          // TODO: adjust after live inspect
      rooms:      text(".rooms-char"),            // TODO: adjust
      area:       text(".area-char"),             // TODO: adjust
      floor:      text(".floor-char"),            // TODO: adjust
      district:   text(".district-char"),         // TODO: adjust
      khoroo:     text(".khoroo-char"),           // TODO: adjust
      building:   text(".building-char"),         // TODO: adjust
      detailPath: $el.find("a[href]").first().attr("href") ?? "",
    });
  });
  return rows;
}

// ── shared parse logic ────────────────────────────────────────────────────────

function parseListing(raw: RawListing, listingType: "sale" | "rent"): ListingRecord {
  const externalId = raw.detailPath.split("/").filter(Boolean).pop() ?? "";
  if (!externalId) {
    throw new Error(
      `unegui.mn: no externalId from detailPath. Row: ${JSON.stringify(raw)}`,
    );
  }

  const areaRaw = raw.area ? parseFloat(raw.area.replace(/[^\d.]/g, "")) : null;
  const areaM2  = areaRaw !== null && !isNaN(areaRaw) ? areaRaw : null;

  const parsedPrice = raw.price ? parseMnt(raw.price) : null;
  const priceMnt    = parsedPrice != null ? Number(parsedPrice) : null;

  const pricePerM2 = priceMnt != null && areaM2 != null && areaM2 > 0
    ? priceMnt / areaM2
    : null;

  const roomsRaw = raw.rooms ? parseInt(raw.rooms, 10) : NaN;
  const floorRaw = raw.floor ? parseInt(raw.floor, 10) : NaN;

  return {
    externalId,
    listingType,
    district:  raw.district ? normalizeDistrict(raw.district) : null,
    khoroo:    raw.khoroo   ? normalizeText(raw.khoroo)       : null,
    rooms:     !isNaN(roomsRaw) ? roomsRaw : null,
    areaM2,
    floor:     !isNaN(floorRaw) ? floorRaw : null,
    building:  raw.building ? normalizeText(raw.building)     : null,
    priceMnt,
    pricePerM2,
    raw: raw as unknown as Record<string, unknown>,
  };
}

// ── selector-drift guard ────────────────────────────────────────────────────
// A missing container selector usually means the site's markup changed, not
// that there are zero results — report it and degrade to "0 listings this
// page" so fetchPage() can continue rather than failing the whole job.

export function checkListingContainer($: CheerioAPI, url: string): boolean {
  return selectorPresent($, SEL.CARD, url, {
    sourceLabel: "Unegui",
    message: "listing container not found — selector may have changed",
  });
}

// ── fetchPage (shared, parameterised by URL) ──────────────────────────────────

async function fetchListingPage(
  url: string,
  cursor?: string,
): Promise<{ raw: RawListing[]; nextCursor?: string }> {
  const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;
  await limiter.acquire();

  const pageUrl = `${url}?page=${pageNum}`;
  const html = await fetchRenderedHtml(pageUrl, { pageWaitMs: 3_000, userAgent: USER_AGENT });
  const $ = cheerio.load(html);

  if (!checkListingContainer($, pageUrl)) {
    return { raw: [] };
  }

  const raw     = extractRows($);
  const hasNext = $(SEL.NEXT_PAGE).length > 0;

  return { raw, ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}) };
}

// ── exported sources ──────────────────────────────────────────────────────────

export const uneguiSaleSource: Source<RawListing, ListingRecord> = {
  id:          SOURCE_ID,
  fetchPage:   (cursor) => fetchListingPage(SALE_URL, cursor),
  parse:       (raw)    => parseListing(raw, "sale"),
  schema:      ListingRecordSchema,
  contentHash: listingContentHash,
  filter:      (r)      => r.district !== null,
};

export const uneguiRentSource: Source<RawListing, ListingRecord> = {
  id:          SOURCE_ID,
  fetchPage:   (cursor) => fetchListingPage(RENT_URL, cursor),
  parse:       (raw)    => parseListing(raw, "rent"),
  schema:      ListingRecordSchema,
  contentHash: listingContentHash,
  filter:      (r)      => r.district !== null,
};
