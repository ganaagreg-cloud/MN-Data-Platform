import { describe, it, expect } from "vitest";
import { tenderContentHash, TenderRecordSchema } from "./tender-schema.js";
import type { TenderRecord } from "@mn-platform/core";

const base: TenderRecord = {
  externalId:         "TD-001",
  tenderNo:           "ТД-2026-001",
  procuringEntity:    "Монгол улс",
  category:           "Барилга",
  estBudgetMnt:       "1000000.00",
  announceDate:       new Date("2026-06-01T00:00:00Z"),
  submissionDeadline: new Date("2026-07-01T00:00:00Z"),
  bidSecurityMnt:     "50000.00",
  aimag:              "УБ",
  status:             "announced",
  fetchedVia:         "playwright",
  raw:                {},
};

describe("tenderContentHash", () => {
  it("is deterministic for the same input", () => {
    expect(tenderContentHash(base)).toBe(tenderContentHash(base));
  });

  it("changes when status changes", () => {
    const modified = { ...base, status: "closed" };
    expect(tenderContentHash(base)).not.toBe(tenderContentHash(modified));
  });

  it("is identical regardless of fetchedVia value", () => {
    const playwright = { ...base, fetchedVia: "playwright" };
    const api        = { ...base, fetchedVia: "api" };
    expect(tenderContentHash(playwright)).toBe(tenderContentHash(api));
  });
});

describe("TenderRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(() => TenderRecordSchema.parse(base)).not.toThrow();
  });

  it("rejects a record with empty externalId", () => {
    expect(() => TenderRecordSchema.parse({ ...base, externalId: "" })).toThrow();
  });

  it("accepts null nullable fields", () => {
    const minimal = {
      ...base,
      tenderNo: null, procuringEntity: null, category: null,
      estBudgetMnt: null, announceDate: null, submissionDeadline: null,
      bidSecurityMnt: null, aimag: null,
    };
    expect(() => TenderRecordSchema.parse(minimal)).not.toThrow();
  });
});
