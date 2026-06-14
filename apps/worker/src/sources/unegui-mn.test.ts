// apps/worker/src/sources/unegui-mn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";

vi.mock("@sentry/node", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { uneguiSaleSource, uneguiRentSource, checkListingContainer } from "./unegui-mn.js";
import { logger } from "../logger.js";

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

describe("checkListingContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns true when the container selector is present", () => {
    const $ = cheerio.load('<div class="list-announcement-block">listing</div>');

    const found = checkListingContainer($, "https://example.com/?page=1");

    expect(found).toBe(true);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns false, warns, and reports to Sentry when the container selector is missing", () => {
    const $ = cheerio.load("<div>no listings here</div>");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const found = checkListingContainer($, "https://example.com/?page=1");

    expect(found).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      { url: "https://example.com/?page=1" },
      "listing container not found — selector may have changed",
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Unegui selector not found", {
      level: "warning",
      extra: { url: "https://example.com/?page=1" },
    });
  });
});
