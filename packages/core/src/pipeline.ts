import type { Source, RunResult, TenderRecord } from "./types.js";

/**
 * DB-adapter interface accepted by runPipeline.
 * The worker passes a thin wrapper around Drizzle so that packages/core
 * carries no dependency on drizzle-orm or @mn-platform/db.
 */
export interface PipelineDb {
  upsertTender(
    sourceId: string,
    contentHash: string,
    record: TenderRecord,
  ): Promise<UpsertOutcome>;
}

export type UpsertOutcome = "created" | "updated" | "unchanged";

/**
 * Generic ingestion pipeline.
 *
 * For each page returned by source.fetchPage():
 *   1. parse(raw) → TRecord
 *   2. source.schema.parse(record) — Zod validation
 *   3. contentHash(record)
 *   4. delegate upsert to db.upsertTender()
 *
 * Errors on individual rows are counted; they do not abort the run.
 *
 * Alert/notification jobs are NOT enqueued here — that is a separate
 * pg-boss job keyed on (record_id, content_hash) outside this transaction.
 */
export async function runPipeline<TRaw, TRecord extends TenderRecord>(
  source: Source<TRaw, TRecord>,
  db: PipelineDb,
): Promise<RunResult> {
  const start = Date.now();
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let errors = 0;
  let cursor: string | undefined;

  do {
    const { raw, nextCursor } = await source.fetchPage(cursor);
    fetched += raw.length;

    for (const rawRow of raw) {
      try {
        const record = source.parse(rawRow);
        const validated = source.schema.parse(record) as TRecord;
        const hash = source.contentHash(validated);

        const outcome = await db.upsertTender(source.id, hash, validated);
        if (outcome === "created") created++;
        else if (outcome === "updated") updated++;
      } catch (err) {
        errors++;
        console.error(
          JSON.stringify({
            source: source.id,
            event: "row_error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    cursor = nextCursor;
  } while (cursor !== undefined);

  return {
    source: source.id,
    fetched,
    created,
    updated,
    errors,
    durationMs: Date.now() - start,
  };
}
