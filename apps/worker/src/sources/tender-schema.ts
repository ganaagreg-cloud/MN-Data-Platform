import { z } from "zod";
import { sha256 } from "@mn-platform/core";
import type { TenderRecord } from "@mn-platform/core";

export const TenderRecordSchema = z.object({
  externalId:         z.string().min(1),
  tenderNo:           z.string().nullable(),
  procuringEntity:    z.string().nullable(),
  category:           z.string().nullable(),
  estBudgetMnt:       z.string().nullable(),
  announceDate:       z.date().nullable(),
  submissionDeadline: z.date().nullable(),
  bidSecurityMnt:     z.string().nullable(),
  aimag:              z.string().nullable(),
  status:             z.string(),
  fetchedVia:         z.string(),
  raw:                z.record(z.string(), z.unknown()),
});

/**
 * Hash only canonical business fields.
 * fetchedVia is intentionally excluded: switching adapters must not re-alert users.
 * Scrape timestamps must never appear here.
 */
export function tenderContentHash(r: TenderRecord): string {
  return sha256(
    [
      r.tenderNo            ?? "",
      r.procuringEntity     ?? "",
      r.submissionDeadline?.toISOString() ?? "",
      r.estBudgetMnt        ?? "",
      r.status,
    ].join("|"),
  );
}
