// packages/core/src/types.ts
import type { ZodSchema } from "zod";

export type UpsertOutcome = "created" | "updated" | "unchanged";

export interface Source<TRaw, TRecord> {
  readonly id: string;
  fetchPage(cursor?: string): Promise<{ raw: TRaw[]; nextCursor?: string }>;
  parse(raw: TRaw): TRecord;
  schema: ZodSchema<TRecord>;
  contentHash(record: TRecord): string;
  /** Optional. Records where this returns false are skipped — not upserted, not alerted. */
  filter?(record: TRecord): boolean;
}

export interface TenderRecord {
  externalId: string;
  tenderNo: string | null;
  procuringEntity: string | null;
  category: string | null;
  /** numeric(18,2) as a string — never a JS number */
  estBudgetMnt: string | null;
  announceDate: Date | null;
  submissionDeadline: Date | null;
  /** numeric(18,2) as a string — never a JS number */
  bidSecurityMnt: string | null;
  aimag: string | null;
  status: string;
  /**
   * Which adapter wrote this record ("crawlbase" | "api" | future).
   * Excluded from contentHash — switching adapters must not trigger re-alerts.
   */
  fetchedVia: string;
  raw: Record<string, unknown>;
}

export interface ListingRecord {
  externalId: string;
  listingType: "sale" | "rent";
  district: string | null;     // normalizeDistrict() output — null means outside UB
  khoroo: string | null;
  rooms: number | null;
  areaM2: number | null;       // stored as number; toFixed(2) only in upsertListing
  floor: number | null;
  building: string | null;
  priceMnt: number | null;     // sale price or monthly rent; toFixed(2) only in upsertListing
  pricePerM2: number | null;   // derived: priceMnt / areaM2; null if either null or areaM2 === 0
  raw: Record<string, unknown>;
}

/** Returned by runPipeline. */
export interface PipelineResult {
  source: string;
  fetched: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  /** Total fetchPage() calls made (one per page/cursor). */
  pagesFetched: number;
  /** Of pagesFetched, how many returned zero rows. */
  emptyPages: number;
}
