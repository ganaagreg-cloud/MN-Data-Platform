// packages/core/src/listing-pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runListingPipeline } from "./listing-pipeline.js";
import type { ListingPipelineDb } from "./listing-pipeline.js";
import type { Source, ListingRecord } from "./types.js";
import { z } from "zod";

const record: ListingRecord = {
  externalId:  "L-001",
  listingType: "sale",
  district:    "БЗД",
  khoroo:      null,
  rooms:       2,
  areaM2:      50,
  floor:       3,
  building:    null,
  priceMnt:    100_000_000,
  pricePerM2:  2_000_000,
  raw:         {},
};

const schema = z.object({
  externalId: z.string(), listingType: z.enum(["sale", "rent"]),
  district: z.string().nullable(), khoroo: z.string().nullable(),
  rooms: z.number().nullable(), areaM2: z.number().nullable(),
  floor: z.number().nullable(), building: z.string().nullable(),
  priceMnt: z.number().nullable(), pricePerM2: z.number().nullable(),
  raw: z.record(z.string(), z.unknown()),
});

describe("runListingPipeline", () => {
  it("upserts a record and returns new=1", async () => {
    const upsertListing = vi.fn().mockResolvedValue("created");
    const db: ListingPipelineDb = { upsertListing };
    const source: Source<ListingRecord, ListingRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runListingPipeline(source, db);

    expect(upsertListing).toHaveBeenCalledOnce();
    expect(result.new).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.fetched).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("skips records where source.filter returns false", async () => {
    const upsertListing = vi.fn().mockResolvedValue("created");
    const db: ListingPipelineDb = { upsertListing };
    const source: Source<ListingRecord, ListingRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [{ ...record, district: null }] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: (r) => r.district !== null,
    };

    const result = await runListingPipeline(source, db);

    expect(upsertListing).not.toHaveBeenCalled();
    expect(result.new).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
  });
});
