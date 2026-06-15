// apps/worker/src/sources/selector-guard.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";

vi.mock("@sentry/node", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { selectorPresent } from "./selector-guard.js";
import { logger } from "../logger.js";

describe("selectorPresent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns true when the selector matches an element", () => {
    const $ = cheerio.load('<div class="card">hello</div>');

    const found = selectorPresent($, ".card", "https://example.com/?page=1", {
      sourceLabel: "Unegui",
      message: "listing container not found — selector may have changed",
    });

    expect(found).toBe(true);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns false, warns, and reports to Sentry when the selector is absent", () => {
    const $ = cheerio.load('<div class="other">hello</div>');
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const found = selectorPresent($, ".card", "https://example.com/?page=1", {
      sourceLabel: "Unegui",
      message: "listing container not found — selector may have changed",
    });

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
