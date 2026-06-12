// apps/worker/src/sources/listing-schema.test.ts
import { describe, it, expect } from "vitest";
import { listingContentHash, ListingRecordSchema } from "./listing-schema.js";
import type { ListingRecord } from "@mn-platform/core";

const base: ListingRecord = {
  externalId:  "L-001",
  listingType: "sale",
  district:    "БЗД",
  khoroo:      "1-р хороо",
  rooms:       3,
  areaM2:      75.5,
  floor:       5,
  building:    "Улаанбаатар хотхон",
  priceMnt:    150_000_000,
  pricePerM2:  1_986_755,
  raw:         {},
};

describe("listingContentHash", () => {
  it("is deterministic for the same input", () => {
    expect(listingContentHash(base)).toBe(listingContentHash(base));
  });

  it("changes when priceMnt changes", () => {
    const modified = { ...base, priceMnt: 200_000_000 };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("changes when district changes", () => {
    const modified = { ...base, district: "СБД" };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("is identical regardless of raw snapshot", () => {
    const a = { ...base, raw: { scraped_at: "2026-06-12T00:00:00Z" } };
    const b = { ...base, raw: { scraped_at: "2026-06-13T00:00:00Z" } };
    expect(listingContentHash(a)).toBe(listingContentHash(b));
  });
});

describe("ListingRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(() => ListingRecordSchema.parse(base)).not.toThrow();
  });

  it("rejects empty externalId", () => {
    expect(() => ListingRecordSchema.parse({ ...base, externalId: "" })).toThrow();
  });

  it("accepts all-null nullable fields", () => {
    const minimal = {
      ...base,
      district: null, khoroo: null, rooms: null,
      areaM2: null, floor: null, building: null,
      priceMnt: null, pricePerM2: null,
    };
    expect(() => ListingRecordSchema.parse(minimal)).not.toThrow();
  });
});
