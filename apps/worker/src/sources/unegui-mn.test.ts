// apps/worker/src/sources/unegui-mn.test.ts
import { describe, it, expect } from "vitest";
import { uneguiSaleSource, uneguiRentSource } from "./unegui-mn.js";

const baseRaw = {
  price:      "150,000,000₮",
  rooms:      "3",
  area:       "75.5 м²",
  floor:      "5",
  district:   "Баянзүрх",
  khoroo:     "1-р хороо",
  building:   "Улаанбаатар хотхон",
  detailPath: "/zar/12345678/",
};

describe("source IDs", () => {
  it("uneguiSaleSource.id is unegui.mn", () => {
    expect(uneguiSaleSource.id).toBe("unegui.mn");
  });

  it("uneguiRentSource.id is unegui.mn", () => {
    expect(uneguiRentSource.id).toBe("unegui.mn");
  });
});

describe("filter", () => {
  it("returns false when district is null (outside UB)", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, district: "" });
    expect(uneguiSaleSource.filter!(record)).toBe(false);
  });

  it("returns true for a valid UB district", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(uneguiSaleSource.filter!(record)).toBe(true);
  });
});

describe("parse — listingType", () => {
  it("sale source sets listingType: sale", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.listingType).toBe("sale");
  });

  it("rent source sets listingType: rent", () => {
    const record = uneguiRentSource.parse(baseRaw);
    expect(record.listingType).toBe("rent");
  });
});

describe("parse — pricePerM2", () => {
  it("is computed as priceMnt / areaM2", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    // parseMnt("150,000,000₮") → "150000000.00" → 150_000_000
    // parseFloat("75.5 м²") → 75.5
    expect(record.pricePerM2).toBeCloseTo(150_000_000 / 75.5, 0);
  });

  it("is null when price is empty", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, price: "" });
    expect(record.pricePerM2).toBeNull();
  });

  it("is null when areaM2 is 0", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, area: "0 м²" });
    expect(record.pricePerM2).toBeNull();
  });
});

describe("parse — externalId", () => {
  it("derives externalId from detailPath trailing segment", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.externalId).toBe("12345678");
  });

  it("throws when detailPath is empty", () => {
    expect(() => uneguiSaleSource.parse({ ...baseRaw, detailPath: "" })).toThrow(
      "no externalId",
    );
  });
});
