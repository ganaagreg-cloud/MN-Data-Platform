// apps/worker/src/listing-pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "@mn-platform/core";
import type { Source, ListingRecord, UpsertOutcome } from "@mn-platform/core";
import { ListingRecordSchema, listingContentHash } from "./sources/listing-schema.js";

const outOfUbRecord: ListingRecord = {
  externalId:  "L-999",
  listingType: "sale",
  district:    null,   // outside UB — filter must reject this
  khoroo:      null,
  rooms:       null,
  areaM2:      null,
  floor:       null,
  building:    null,
  priceMnt:    null,
  pricePerM2:  null,
  raw:         {},
};

describe("runPipeline — listing filter integration", () => {
  it("skips records where source.filter returns false — upsert never called", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");

    const source: Source<ListingRecord, ListingRecord> = {
      id:          "test.source",
      fetchPage:   async () => ({ raw: [outOfUbRecord] }),
      parse:       (r) => r,
      schema:      ListingRecordSchema,
      contentHash: listingContentHash,
      filter:      (r) => r.district !== null,
    };

    const result = await runPipeline({ source, upsert });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.new).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.fetched).toBe(1);
  });
});
