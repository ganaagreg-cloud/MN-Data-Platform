import type { ZodSchema } from "zod";

/**
 * Every external data source implements this interface.
 * TRaw  — the shape that comes off the wire (after JSON.parse / HTML parse)
 * TRecord — the canonical, validated shape stored in Postgres
 */
export interface Source<TRaw, TRecord> {
  /** Stable identifier, e.g. "tender.gov.mn" */
  readonly id: string;

  /**
   * Fetches one page from the source.
   * cursor is opaque — the pipeline passes back whatever nextCursor the
   * previous call returned. Omit cursor to start from page 1.
   * Returns an empty raw array and no nextCursor to signal end-of-feed.
   */
  fetchPage(cursor?: string): Promise<{ raw: TRaw[]; nextCursor?: string }>;

  /**
   * Pure transformation: one raw row → one canonical record.
   * Must throw (not return null) on structurally unparseable input so the
   * pipeline can log and skip the row without crashing the run.
   */
  parse(raw: TRaw): TRecord;

  /**
   * Zod schema applied to parse() output before touching the DB.
   * Schema validation failure is treated the same as a parse() throw.
   */
  schema: ZodSchema<TRecord>;

  /**
   * Deterministic hash over canonical business fields only.
   * Scrape timestamps and last_seen_at MUST NOT be included.
   * An unchanged record must always produce the same hash so the pipeline
   * can skip no-op upserts and suppress duplicate alerts.
   */
  contentHash(record: TRecord): string;
}

/**
 * Minimum shape every TRecord passed to runPipeline must satisfy.
 * Source adapters extend this with their own validated fields.
 * Money amounts are string so Drizzle writes them as numeric(18,2) without
 * floating-point rounding.
 */
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
   * Which adapter wrote this record ("playwright" | "api" | future).
   * Excluded from contentHash — switching adapters must not trigger re-alerts.
   */
  fetchedVia: string;
  raw: Record<string, unknown>;
}

/** What the pipeline returns after processing one full source run. */
export interface RunResult {
  source: string;
  fetched: number;
  created: number;
  updated: number;
  errors: number;
  durationMs: number;
}
