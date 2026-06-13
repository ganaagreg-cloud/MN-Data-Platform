// packages/core/src/notifications/telegram.ts
//
// Internal ops/activity feed — NOT the customer-facing alert system
// (see apps/worker/src/alerts/dispatch.ts + notifications_sent for that).
// Posts a best-effort message to a single Telegram chat whenever a scrape
// job sees a new or changed record. Callers must catch their own errors
// (see onChanged in RunPipelineOptions) — sendTelegramMessage rejects on
// any failure so the caller decides whether/how to log it.

import { formatMnt } from "@mn-platform/mn";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * POSTs a message to an arbitrary Telegram chat via the bot identified by
 * TELEGRAM_BOT_TOKEN (read from process.env). Rejects if the token is
 * missing or the Telegram API responds with a non-2xx status.
 */
export async function sendTelegramMessageTo(chatId: string | number, text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN must be set");
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

/**
 * POSTs a message to TELEGRAM_CHAT_ID via the bot identified by
 * TELEGRAM_BOT_TOKEN (both read from process.env). Rejects if either env
 * var is missing or the Telegram API responds with a non-2xx status.
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
  }

  return sendTelegramMessageTo(chatId, text);
}

export interface ListingAlertInput {
  listingType: "sale" | "rent";
  district: string | null;
  khoroo: string | null;
  building: string | null;
  areaM2: number | null;
  floor: number | null;
  priceMnt: number | null;
  url: string;
  /** Previous priceMnt — only used (and only meaningful) when changeType is "changed". */
  previousPriceMnt?: number | null | undefined;
}

export interface TenderAlertInput {
  procuringEntity: string | null;
  title: string | null;
  submissionDeadline: Date | null;
  /** numeric(18,2) as a string (from TenderRecord), or a plain number. */
  estBudgetMnt: string | number | null;
  url: string;
}

export function formatListingAlert(
  listing: ListingAlertInput,
  changeType: "new" | "changed",
): string {
  const heading = changeType === "new" ? "new listing" : "updated listing";
  const location = [listing.district, listing.khoroo, listing.building]
    .filter((part): part is string => !!part)
    .map(escapeHtml)
    .join(", ");
  const typeLabel = listing.listingType === "sale" ? "Sale" : "Rent";
  const area = listing.areaM2 != null ? `${listing.areaM2} m²` : "? m²";
  const floor = listing.floor != null ? `Floor ${listing.floor}` : "Floor ?";

  const priceLine =
    changeType === "changed" &&
    listing.previousPriceMnt != null &&
    listing.priceMnt != null &&
    listing.previousPriceMnt !== listing.priceMnt
      ? formatPriceChange(listing.previousPriceMnt, listing.priceMnt)
      : listing.priceMnt != null
        ? formatMnt(listing.priceMnt)
        : "—";

  return [
    `<b>\u{1F3E0} GazarPrice — ${heading}</b>`,
    "",
    `\u{1F4CD} ${location || "Unknown location"}`,
    `\u{1F3F7} ${typeLabel} · ${area} · ${floor}`,
    `\u{1F4B0} ${priceLine}`,
    "",
    `<a href="${escapeHtml(listing.url)}">View listing</a>`,
  ].join("\n");
}

export function formatTenderAlert(tender: TenderAlertInput): string {
  const deadline = tender.submissionDeadline
    ? tender.submissionDeadline.toISOString().slice(0, 10)
    : "—";
  const budget = tender.estBudgetMnt != null ? formatMnt(tender.estBudgetMnt) : "—";

  return [
    `<b>\u{1F4CB} TenderAlert — new tender</b>`,
    "",
    `\u{1F3E2} ${escapeHtml(tender.procuringEntity ?? "—")}`,
    `\u{1F4C4} ${escapeHtml(tender.title ?? "—")}`,
    `⏰ Deadline: ${deadline}`,
    `\u{1F4B0} ${budget}`,
    "",
    `<a href="${escapeHtml(tender.url)}">View tender</a>`,
  ].join("\n");
}

function formatPriceChange(previous: number, current: number): string {
  if (previous === 0) {
    return `${formatMnt(previous)} → ${formatMnt(current)}`;
  }
  const diffPct = ((current - previous) / previous) * 100;
  const sign = diffPct >= 0 ? "+" : "";
  return `${formatMnt(previous)} → ${formatMnt(current)} (${sign}${diffPct.toFixed(1)}%)`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
