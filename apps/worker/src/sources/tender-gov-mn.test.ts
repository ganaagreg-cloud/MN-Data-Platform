// apps/worker/src/sources/tender-gov-mn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";

vi.mock("@sentry/node", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { tenderGovMnSource, checkRowContainer } from "./tender-gov-mn.js";
import { logger } from "../logger.js";

describe("tenderGovMnSource", () => {
  it("has id tender.gov.mn", () => {
    expect(tenderGovMnSource.id).toBe("tender.gov.mn");
  });
});

describe("parse — fetchedVia", () => {
  it("sets fetchedVia: crawlbase", () => {
    const record = tenderGovMnSource.parse({
      tenderNo: "TA/2026/001",
      title: "Сургуулийн тоног төхөөрөмж",
      procuringEntity: "Боловсролын яам",
      category: "Бараа",
      estBudgetMnt: "500,000,000₮",
      submissionDeadline: "2026-07-01",
      announceDate: "2026-06-01",
      bidSecurityMnt: "10,000,000₮",
      aimag: "Улаанбаатар",
      status: "Зарласан",
      detailPath: "/mn/invitation/123",
    });

    expect(record.fetchedVia).toBe("crawlbase");
  });
});

describe("checkRowContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns true when the row selector is present", () => {
    const $ = cheerio.load("<table><tbody><tr><td>1</td></tr></tbody></table>");

    const found = checkRowContainer($, "https://example.com/?page=1");

    expect(found).toBe(true);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns false, warns, and reports to Sentry when the row selector is missing", () => {
    const $ = cheerio.load("<div>no tenders here</div>");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const found = checkRowContainer($, "https://example.com/?page=1");

    expect(found).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      { url: "https://example.com/?page=1" },
      "tender row container not found — selector may have changed",
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Tender selector not found", {
      level: "warning",
      extra: { url: "https://example.com/?page=1" },
    });
  });
});
