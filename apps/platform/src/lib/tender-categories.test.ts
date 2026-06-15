import { describe, it, expect } from "vitest";
import { TENDER_CATEGORIES } from "./tender-categories";

describe("TENDER_CATEGORIES", () => {
  it("is a non-empty array of strings", () => {
    expect(TENDER_CATEGORIES.length).toBeGreaterThan(0);
    for (const cat of TENDER_CATEGORIES) {
      expect(typeof cat).toBe("string");
      expect(cat.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(TENDER_CATEGORIES);
    expect(unique.size).toBe(TENDER_CATEGORIES.length);
  });
});
