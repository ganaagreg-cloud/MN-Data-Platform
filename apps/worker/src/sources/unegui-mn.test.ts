// apps/worker/src/sources/unegui-mn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";

vi.mock("@sentry/node", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { uneguiSaleSource, uneguiRentSource, checkListingContainer } from "./unegui-mn.js";
import { logger } from "../logger.js";

// Captured from a live unegui.mn sale-listing card (.advert.js-item-listing).
const baseRaw = {
  externalId: "10408434",
  price:      "1.07 Тэрбум ₮ 1.15 Тэрбум ₮",
  title:      "Сбд драмын театрын урд элит хотхонд 184,7мкв 5өрөө",
  place:      "Сүхбаатар, Сүхбаатар, Хороо 2",
  detailPath: "/adv/10408434_dramyn-teatryn-urd-bairlakh-elit-khotkhond-184-7-mkv-5-oroo-bair-zarna/",
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
  it("returns false when place has no recognizable UB district", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, place: "Дархан-Уул, Дархан" });
    expect(uneguiSaleSource.filter!(record)).toBe(false);
  });

  it("returns true for a valid UB district", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(uneguiSaleSource.filter!(record)).toBe(true);
  });
});

describe("parse — district & khoroo", () => {
  it("derives district from the place field", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.district).toBe("Сүхбаатар");
  });

  it("derives khoroo as the last comma-separated place segment", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.khoroo).toBe("Хороо 2");
  });

  it("khoroo is null when place has only a district", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, place: "Сүхбаатар" });
    expect(record.khoroo).toBeNull();
  });
});

describe("parse — area & rooms from title", () => {
  it("parses areaM2, handling a comma decimal separator", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.areaM2).toBeCloseTo(184.7, 1);
  });

  it("parses rooms count", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.rooms).toBe(5);
  });

  it("areaM2 and rooms are null when the title has no matching pattern", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, title: "Тавилгатай орон сууц зарна" });
    expect(record.areaM2).toBeNull();
    expect(record.rooms).toBeNull();
  });
});

describe("parse — floor & building", () => {
  it("are always null (not available on listing cards)", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.floor).toBeNull();
    expect(record.building).toBeNull();
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

describe("parse — price", () => {
  it("parses the leading Тэрбум price, ignoring a trailing discount span", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    // parseMnt("1.07 Тэрбум ₮ 1.15 Тэрбум ₮") → "1070000000.00"
    expect(record.priceMnt).toBe(1_070_000_000);
  });

  it("parses сая (million) prices", () => {
    const record = uneguiRentSource.parse({ ...baseRaw, price: "4.5 сая ₮" });
    expect(record.priceMnt).toBe(4_500_000);
  });
});

describe("parse — pricePerM2", () => {
  it("is computed as priceMnt / areaM2", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.pricePerM2).toBeCloseTo(1_070_000_000 / 184.7, 0);
  });

  it("is null when price is empty", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, price: "" });
    expect(record.pricePerM2).toBeNull();
  });

  it("is null when areaM2 cannot be parsed from the title", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, title: "Тавилгатай орон сууц зарна" });
    expect(record.pricePerM2).toBeNull();
  });
});

describe("parse — externalId", () => {
  it("uses the raw externalId (data-id) directly", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.externalId).toBe("10408434");
  });

  it("throws when externalId is empty", () => {
    expect(() => uneguiSaleSource.parse({ ...baseRaw, externalId: "" })).toThrow(
      "missing data-id",
    );
  });
});

describe("checkListingContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns true when the container selector is present", () => {
    const $ = cheerio.load('<div class="advert js-item-listing">listing</div>');

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
