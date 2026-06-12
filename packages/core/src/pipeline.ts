// packages/core/src/pipeline.ts
import type { Source, PipelineResult, TenderRecord, UpsertOutcome } from "./types.js";

export interface PipelineDb {
  upsertTender(
    sourceId: string,
    contentHash: string,
    record: TenderRecord,
  ): Promise<UpsertOutcome>;
}

export async function runPipeline<TRaw, TRecord extends TenderRecord>(
  source: Source<TRaw, TRecord>,
  db: PipelineDb,
): Promise<PipelineResult> {
  const start = Date.now();
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined;

  do {
    const { raw, nextCursor } = await source.fetchPage(cursor);
    fetched += raw.length;

    for (const rawRow of raw) {
      try {
        const record = source.parse(rawRow);
        const validated = source.schema.parse(record) as TRecord;

        if (source.filter && !source.filter(validated)) {
          skipped++;
          continue;
        }

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
    new: created,
    updated,
    skipped,
    errors,
    durationMs: Date.now() - start,
  };
}
