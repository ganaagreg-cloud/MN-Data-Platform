// apps/worker/src/sources/listing-schema.test.ts
import { describe, it, expect, vi } from "vitest";
import { listingContentHash, ListingRecordSchema, warnZeroValueListing } from "./listing-schema.js";
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

  it("changes when khoroo changes", () => {
    const modified = { ...base, khoroo: "2-р хороо" };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("changes when floor changes", () => {
    const modified = { ...base, floor: 6 };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("changes when building changes", () => {
    const modified = { ...base, building: "Шинэ хотхон" };
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

  it("accepts areaM2 = 0 (e.g. studio with unset area in source data)", () => {
    expect(() => ListingRecordSchema.parse({ ...base, areaM2: 0 })).not.toThrow();
  });

  it("accepts priceMnt = 0 and pricePerM2 = 0 (e.g. negotiable-price listing)", () => {
    expect(() =>
      ListingRecordSchema.parse({ ...base, priceMnt: 0, pricePerM2: 0 }),
    ).not.toThrow();
  });
});

describe("warnZeroValueListing", () => {
  it("warns when areaM2 is 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnZeroValueListing("unegui.mn/sale", { ...base, areaM2: 0, pricePerM2: null });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(warnSpy.mock.calls[0]![0] as string)).toMatchObject({
      source: "unegui.mn/sale",
      event: "zero_value_listing",
      externalId: base.externalId,
      areaM2: 0,
    });
    warnSpy.mockRestore();
  });

  it("warns when priceMnt is 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnZeroValueListing("unegui.mn/rent", { ...base, priceMnt: 0, pricePerM2: 0 });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(warnSpy.mock.calls[0]![0] as string)).toMatchObject({
      source: "unegui.mn/rent",
      event: "zero_value_listing",
      externalId: base.externalId,
      priceMnt: 0,
    });
    warnSpy.mockRestore();
  });

  it("does not warn for non-zero areaM2 and priceMnt", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnZeroValueListing("unegui.mn/sale", base);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
