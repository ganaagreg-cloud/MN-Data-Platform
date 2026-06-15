// apps/worker/src/sources/tender-gov-mn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";

vi.mock("@sentry/node", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { tenderGovMnSource, checkRowContainer, extractRows } from "./tender-gov-mn.js";
import { logger } from "../logger.js";

// Captured from a live https://user.tender.gov.mn/mn/invitation?year=allYear&get=1 row.
const REAL_ROW_HTML = `
<div class="tender-result-table"><div class="table-responsive"><table class="table"><tbody>
<tr>
<td width="12%">
<time datetime="2020-04-06" class="icon" title="Хүлээн авах хугацаа">
    <em>11:00</em>
    <span class="year">2020-04</span>
    <span class="date">06</span>
</time>
</td>
<td>
<a href="/mn/invitation/detail/1583991113609" class="tender-name">
    Сумын төвийн камержуулалт
</a>
<div class="client-name">
<span>Захиалагчийн нэр:</span>
<a href="/mn/client/detail/1453535505019">
Дорноговь аймгийн Сайхандулаан сумын засаг даргын тамгын газар
</a>
</div>
<div class="client-name">
<span>ХАА-ны журам:</span>
Тендер шалгаруулалтын онцгой журам
</div>
<div class="view-status">
<span class="days-left blue">
Үр дүн гарсан
</span>
<span class="days-left pull-right budget">
33,000,000 ₮
</span>
</div>
<div class="hidden-lg hidden-md hidden-sm hidden-xs invitation-number small">
Урилгын дугаар<div class="number">ДГАСДЗДТГ/202003005/01/01</div>
</div>
<div class="hidden-lg hidden-md hidden-sm recieve-date small">
Зарласан огноо<div class="date">2020-03-25</div>
</div>
</td>
<td class="hidden-xs" width="16%">
<div class="border-left padding-left-15">
<div class="invitation-number">
Урилгын дугаар<div class="number">ДГАСДЗДТГ/202003005/01/01</div>
</div>
<div class="recieve-date">
Зарласан огноо<div class="date">2020-03-25</div>
</div>
</div>
</td>
</tr>
</tbody></table></div></div>
`;

const NO_RESULTS_HTML = `
<div class="tender-result-table"><table><tbody>
<tr><td colspan="5" class="text-center">Тохирох үр дүн олдсонгүй</td></tr>
</tbody></table></div>
`;

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

describe("extractRows", () => {
  it("extracts all fields from a real row", () => {
    const $ = cheerio.load(REAL_ROW_HTML);
    const rows = extractRows($);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.title.replace(/\s+/g, " ").trim()).toBe("Сумын төвийн камержуулалт");
    expect(row.detailPath).toBe("/mn/invitation/detail/1583991113609");
    expect(row.procuringEntity.replace(/\s+/g, " ").trim()).toBe(
      "Дорноговь аймгийн Сайхандулаан сумын засаг даргын тамгын газар",
    );
    expect(row.tenderNo).toBe("ДГАСДЗДТГ/202003005/01/01");
    expect(row.status.replace(/\s+/g, " ").trim()).toBe("Үр дүн гарсан");
    expect(row.estBudgetMnt.replace(/\s+/g, " ").trim()).toBe("33,000,000 ₮");
    expect(row.announceDate).toBe("2020-03-25");
    expect(row.submissionDeadline).toBe("2020-04-06 11:00");
    expect(row.category).toBe("");
    expect(row.bidSecurityMnt).toBe("");
    expect(row.aimag).toBe("");
  });

  it("skips the 'no results' placeholder row", () => {
    const $ = cheerio.load(NO_RESULTS_HTML);
    expect(extractRows($)).toEqual([]);
  });
});

describe("checkRowContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns true when the row selector is present", () => {
    const $ = cheerio.load(
      '<div class="tender-result-table"><table><tbody><tr><td>1</td></tr></tbody></table></div>',
    );

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
