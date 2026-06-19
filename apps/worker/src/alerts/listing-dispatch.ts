import { z } from "zod";
import { db, listings, eq } from "@mn-platform/db";
import { sendTelegramMessageTo, formatListingAlert } from "@mn-platform/core";
import { insertNotificationSent } from "./idempotency.js";
import { logger } from "../logger.js";

export const ListingAlertPayloadSchema = z.object({
  recordId:       z.string().uuid(),
  contentHash:    z.string().min(1),
  userId:         z.string().uuid(),
  telegramChatId: z.string().min(1),
});

export type ListingAlertPayload = z.infer<typeof ListingAlertPayloadSchema>;

export async function dispatchListingAlert(payload: ListingAlertPayload): Promise<void> {
  const { recordId, contentHash, userId, telegramChatId } = payload;

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, recordId),
  });

  if (!listing) {
    logger.warn({ recordId, event: "listing_not_found" }, "listing alert skipped — record missing");
    return;
  }

  const detailPath =
    typeof (listing.raw as Record<string, unknown>)["detailPath"] === "string"
      ? (listing.raw as Record<string, unknown>)["detailPath"] as string
      : "";

  const text = formatListingAlert(
    {
      listingType:  listing.listingType as "sale" | "rent",
      district:     listing.district,
      khoroo:       listing.khoroo,
      building:     listing.building,
      areaM2:       listing.areaM2 != null ? Number(listing.areaM2) : null,
      floor:        listing.floor,
      priceMnt:     listing.priceMnt != null ? Number(listing.priceMnt) : null,
      url:          `https://www.unegui.mn${detailPath}`,
    },
    "new",
  );

  await sendTelegramMessageTo(telegramChatId, text);

  await insertNotificationSent({ recordId, contentHash, userId, channel: "telegram" });

  logger.info({ recordId, userId, event: "listing_alert_sent" }, "listing alert dispatched");
}
