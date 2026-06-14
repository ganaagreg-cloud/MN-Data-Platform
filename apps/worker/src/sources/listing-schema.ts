// apps/worker/src/sources/listing-schema.ts
import { z } from "zod";
import { sha256 } from "@mn-platform/core";
import type { ListingRecord } from "@mn-platform/core";

export const ListingRecordSchema = z.object({
  externalId:  z.string().min(1),
  listingType: z.enum(["sale", "rent"]),
  district:    z.string().nullable(),
  khoroo:      z.string().nullable(),
  rooms:       z.number().int().nullable(),
  areaM2:      z.number().nonnegative().nullable(),
  floor:       z.number().int().nullable(),
  building:    z.string().nullable(),
  priceMnt:    z.number().nonnegative().nullable(),
  pricePerM2:  z.number().nonnegative().nullable(),
  raw:         z.record(z.string(), z.unknown()),
});

/**
 * Hash canonical business fields only.
 * pricePerM2 excluded — it is derived from priceMnt/areaM2.
 * raw excluded — scrape timestamps must never affect hash.
 */
export function listingContentHash(r: ListingRecord): string {
  return sha256(
    [
      r.listingType,
      r.district    ?? "",
      r.khoroo      ?? "",
      r.rooms       ?? "",
      String(r.areaM2   ?? ""),
      r.floor       ?? "",
      r.building    ?? "",
      String(r.priceMnt ?? ""),
    ].join("|"),
  );
}

/**
 * Logs a warning for listings scraped with a zero area or price — still
 * upserted, but flagged since it often indicates selector drift on the source page.
 */
export function warnZeroValueListing(sourceId: string, record: ListingRecord): void {
  if (record.areaM2 === 0 || record.priceMnt === 0) {
    console.warn(
      JSON.stringify({
        source: sourceId,
        event: "zero_value_listing",
        externalId: record.externalId,
        areaM2: record.areaM2,
        priceMnt: record.priceMnt,
      }),
    );
  }
}
