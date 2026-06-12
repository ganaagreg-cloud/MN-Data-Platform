// apps/worker/src/db-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, tenders, listings } from "@mn-platform/db";
import type {
  PipelineDb,
  ListingPipelineDb,
  UpsertOutcome,
  TenderRecord,
  ListingRecord,
} from "@mn-platform/core";

export function createDbAdapter(): PipelineDb & ListingPipelineDb {
  return {
    async upsertTender(
      sourceId: string,
      contentHash: string,
      record: TenderRecord,
    ): Promise<UpsertOutcome> {
      const now = new Date();

      const existing = await db
        .select({ id: tenders.id, contentHash: tenders.contentHash })
        .from(tenders)
        .where(
          and(
            eq(tenders.sourceId, sourceId),
            eq(tenders.externalId, record.externalId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(tenders).values({
          sourceId,
          externalId:         record.externalId,
          contentHash,
          firstSeenAt:        now,
          lastSeenAt:         now,
          tenderNo:           record.tenderNo,
          procuringEntity:    record.procuringEntity,
          category:           record.category,
          estBudgetMnt:       record.estBudgetMnt,
          announceDate:       record.announceDate,
          submissionDeadline: record.submissionDeadline,
          bidSecurityMnt:     record.bidSecurityMnt,
          aimag:              record.aimag,
          status:             record.status,
          fetchedVia:         record.fetchedVia,
          raw:                record.raw,
        });
        return "created";
      }

      const row = existing[0]!;

      if (row.contentHash === contentHash) {
        await db
          .update(tenders)
          .set({ lastSeenAt: now })
          .where(eq(tenders.id, row.id));
        return "unchanged";
      }

      await db
        .update(tenders)
        .set({
          contentHash,
          lastSeenAt:         now,
          tenderNo:           record.tenderNo,
          procuringEntity:    record.procuringEntity,
          category:           record.category,
          estBudgetMnt:       record.estBudgetMnt,
          announceDate:       record.announceDate,
          submissionDeadline: record.submissionDeadline,
          bidSecurityMnt:     record.bidSecurityMnt,
          aimag:              record.aimag,
          status:             record.status,
          fetchedVia:         record.fetchedVia,
          raw:                record.raw,
        })
        .where(eq(tenders.id, row.id));
      return "updated";
    },

    async upsertListing(
      sourceId: string,
      contentHash: string,
      record: ListingRecord,
    ): Promise<UpsertOutcome> {
      const now = new Date();

      const existing = await db
        .select({ id: listings.id, contentHash: listings.contentHash })
        .from(listings)
        .where(
          and(
            eq(listings.sourceId, sourceId),
            eq(listings.externalId, record.externalId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(listings).values({
          sourceId,
          externalId:  record.externalId,
          contentHash,
          firstSeenAt: now,
          lastSeenAt:  now,
          listingType: record.listingType,
          district:    record.district,
          khoroo:      record.khoroo,
          rooms:       record.rooms,
          areaM2:      record.areaM2     != null ? record.areaM2.toFixed(2)     : null,
          floor:       record.floor,
          building:    record.building,
          priceMnt:    record.priceMnt   != null ? record.priceMnt.toFixed(2)   : null,
          pricePerM2:  record.pricePerM2 != null ? record.pricePerM2.toFixed(2) : null,
          raw:         record.raw,
        });
        return "created";
      }

      const row = existing[0]!;

      if (row.contentHash === contentHash) {
        await db
          .update(listings)
          .set({ lastSeenAt: now })
          .where(eq(listings.id, row.id));
        return "unchanged";
      }

      await db
        .update(listings)
        .set({
          contentHash,
          lastSeenAt:  now,
          listingType: record.listingType,
          district:    record.district,
          khoroo:      record.khoroo,
          rooms:       record.rooms,
          areaM2:      record.areaM2     != null ? record.areaM2.toFixed(2)     : null,
          floor:       record.floor,
          building:    record.building,
          priceMnt:    record.priceMnt   != null ? record.priceMnt.toFixed(2)   : null,
          pricePerM2:  record.pricePerM2 != null ? record.pricePerM2.toFixed(2) : null,
          raw:         record.raw,
        })
        .where(eq(listings.id, row.id));
      return "updated";
    },
  };
}
