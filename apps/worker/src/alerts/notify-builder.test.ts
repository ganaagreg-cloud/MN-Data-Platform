import { describe, it, expect } from "vitest";
import { formatTenderNotification } from "./notify-builder.js";

const tender = {
  id: "abc-123",
  tenderNo: "ТД-2026-001",
  procuringEntity: "Улаанбаатар хот",
  category: "Барилга",
  estBudgetMnt: "500000000.00",
  submissionDeadline: new Date("2026-07-01T16:00:00.000Z"),
  aimag: "УБ",
};

describe("formatTenderNotification", () => {
  it("includes tender number in subject", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.subject).toContain("ТД-2026-001");
    expect(n.recordId).toBe("abc-123");
    expect(n.contentHash).toBe("hash123");
  });

  it("falls back to procuringEntity when tenderNo is null", () => {
    const n = formatTenderNotification({ ...tender, tenderNo: null }, "h");
    expect(n.subject).toContain("Улаанбаатар хот");
  });

  it("body contains procuringEntity and a platform link", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.body).toContain("Улаанбаатар хот");
    expect(n.body).toContain("/tender/abc-123");
  });

  it("body contains digest TODO comment", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.body).toContain("TODO");
  });
});
