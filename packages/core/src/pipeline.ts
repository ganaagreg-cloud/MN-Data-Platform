// packages/core/src/pipeline.ts
import type { Source, PipelineResult, UpsertOutcome } from "./types.js";

export type UpsertFn<TRecord> = (
  sourceId: string,
  contentHash: string,
  record: TRecord,
) => Promise<UpsertOutcome>;

export interface RunPipelineOptions<TRaw, TRecord> {
  source: Source<TRaw, TRecord>;
  upsert: UpsertFn<TRecord>;
  /**
   * Called after schema validation, before the filter/upsert step — runs for
   * every validated record, even ones the filter will skip. Use for
   * source-specific checks (e.g. flagging suspicious zero values).
   */
  onValidated?: (record: TRecord) => void;
  /**
   * Called once per validated, non-skipped record, immediately before upsert
   * — i.e. while the prior row (if any) still holds its old values. Use to
   * capture fields that upsert is about to overwrite (e.g. the previous
   * price) for onChanged. Return undefined if no prior row exists.
   */
  getPrevious?: (record: TRecord) => Promise<Partial<TRecord> | undefined>;
  /**
   * Called after a successful upsert, only when the outcome is "created" or
   * "updated" (never "unchanged"). Must not throw/reject — implementations
   * that perform best-effort side effects (e.g. notifications) should catch
   * and log their own errors so they never affect pipeline error counts.
   */
  onChanged?: (
    record: TRecord,
    outcome: "created" | "updated",
    previous?: Partial<TRecord>,
  ) => void | Promise<void>;
}

export async function runPipeline<TRaw, TRecord>(
  options: RunPipelineOptions<TRaw, TRecord>,
): Promise<PipelineResult> {
  const { source, upsert, onValidated, getPrevious, onChanged } = options;
  const start = Date.now();
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let pagesFetched = 0;
  let emptyPages = 0;
  let cursor: string | undefined;

  do {
    const { raw, nextCursor } = await source.fetchPage(cursor);
    fetched += raw.length;
    pagesFetched++;
    if (raw.length === 0) emptyPages++;

    for (const rawRow of raw) {
      try {
        const record = source.parse(rawRow);
        const validated = source.schema.parse(record);

        onValidated?.(validated);

        if (source.filter && !source.filter(validated)) {
          skipped++;
          continue;
        }

        const hash = source.contentHash(validated);
        const previous = await getPrevious?.(validated);
        const outcome = await upsert(source.id, hash, validated);
        if (outcome === "created") created++;
        else if (outcome === "updated") updated++;

        if (outcome !== "unchanged") {
          await onChanged?.(validated, outcome, previous);
        }
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
    pagesFetched,
    emptyPages,
  };
}
