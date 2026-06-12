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
  areaM2:      z.number().positive().nullable(),
  floor:       z.number().int().nullable(),
  building:    z.string().nullable(),
  priceMnt:    z.number().positive().nullable(),
  pricePerM2:  z.number().positive().nullable(),
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
      r.rooms       ?? "",
      String(r.areaM2   ?? ""),
      String(r.priceMnt ?? ""),
    ].join("|"),
  );
}
