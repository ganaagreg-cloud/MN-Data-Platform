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
  externalId: string;
  price:      string;
  title:      string;
  place:      string;
  detailPath: string;
}

// ── constants ─────────────────────────────────────────────────────────────────

const SOURCE_ID  = "unegui.mn";
// `/ulan-bator/` path redirects to an empty page; UB filtering is done via
// normalizeDistrict() + `filter: r => r.district !== null` downstream.
const SALE_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-zarna/oron-suuts-zarna/";
const RENT_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-treesllne/oron-suuts/";
const USER_AGENT = "GazarPrice/1.0 (+https://gazarprice.mn; info@gazarprice.mn)";

// One token bucket for the entire unegui.mn domain — shared across sale and rent.
const limiter = getRateLimiter("unegui.mn");

// Verified against live rendered DOM 2026-06-18 for both the sale and rent
// listing pages (oron-suuts-zarna / oron-suuts, without /ulan-bator/ path).
const SEL = {
  CARD:      ".advert.js-item-listing",
  PRICE:     ".advert__content-price",
  TITLE:     ".advert__content-title",
  PLACE:     ".advert__content-place",
  NEXT_PAGE: ".number-list-next.js-page-filter",
} as const;

// Area and room count are only available embedded in the listing title, e.g.
// "Сбд драмын театрын урд элит хотхонд 184,7мкв 5өрөө" (note comma decimal).
const AREA_RE  = /(\d+(?:[.,]\d+)?)\s*(?:мкв|м2|м²)/i;
const ROOMS_RE = /(\d+)\s*[-\s]?өрөө/i;

// ── HTML extraction (cheerio) ──────────────────────────────────────────────────
// Store only structured fields — never description text or image URLs.

function extractRows($: CheerioAPI): RawListing[] {
  const rows: RawListing[] = [];
  $(SEL.CARD).each((_i, el) => {
    const $el = $(el);
    const $title = $el.find(SEL.TITLE).first();
    rows.push({
      externalId: $el.attr("data-id") ?? "",
      price:      $el.find(SEL.PRICE).first().text().trim(),
      title:      $title.text().trim(),
      place:      $el.find(SEL.PLACE).first().text().trim(),
      detailPath: $title.attr("href") ?? "",
    });
  });
  return rows;
}

// ── shared parse logic ────────────────────────────────────────────────────────

function parseListing(raw: RawListing, listingType: "sale" | "rent"): ListingRecord {
  if (!raw.externalId) {
    throw new Error(
      `unegui.mn: missing data-id on listing card. Row: ${JSON.stringify(raw)}`,
    );
  }

  const areaMatch = raw.title.match(AREA_RE);
  const areaM2 = areaMatch?.[1]
    ? parseFloat(areaMatch[1].replace(",", "."))
    : null;

  const roomsMatch = raw.title.match(ROOMS_RE);
  const rooms = roomsMatch?.[1] ? parseInt(roomsMatch[1], 10) : null;

  const parsedPrice = raw.price ? parseMnt(raw.price) : null;
  const priceMnt    = parsedPrice != null ? Number(parsedPrice) : null;

  const pricePerM2 = priceMnt != null && areaM2 != null && areaM2 > 0
    ? priceMnt / areaM2
    : null;

  // "Сүхбаатар, 5-р хороолол" / "Сүхбаатар, Сүхбаатар, Хороо 2" — district is
  // whichever comma-separated part normalizes to a known district; khoroo
  // (when present) is the last part, stored verbatim.
  const placeParts = raw.place.split(",").map((p) => normalizeText(p)).filter(Boolean);
  let district: string | null = null;
  for (const part of placeParts) {
    const normalized = normalizeDistrict(part);
    if (normalized) {
      district = normalized;
      break;
    }
  }
  const khoroo = placeParts.length > 1 ? placeParts[placeParts.length - 1]! : null;

  return {
    externalId: raw.externalId,
    listingType,
    district,
    khoroo,
    rooms,
    areaM2,
    floor:    null, // not present on listing cards — would require a detail-page fetch
    building: null, // not present on listing cards — would require a detail-page fetch
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

  // unegui.mn redirects ?page=1 to the base URL — omit the param for page 1.
  const pageUrl = pageNum === 1 ? url : `${url}?page=${pageNum}`;
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
