import { and, eq } from "drizzle-orm";
import { db, tenders } from "@mn-platform/db";
import type { PipelineDb, UpsertOutcome, TenderRecord } from "@mn-platform/core";

export function createDbAdapter(): PipelineDb {
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
          raw:                record.raw,
        })
        .where(eq(tenders.id, row.id));
      return "updated";
    },
  };
}
