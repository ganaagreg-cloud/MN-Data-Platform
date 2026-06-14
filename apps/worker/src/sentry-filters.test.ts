// apps/worker/src/sentry-filters.test.ts
import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import { dropNavigationErrors } from "./sentry-filters.js";

describe("dropNavigationErrors", () => {
  it("drops events caused by a NavigationError", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{ type: "NavigationError", value: "Navigation timeout" }],
      },
    };

    expect(dropNavigationErrors(event)).toBeNull();
  });

  it("passes through events from other error types", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "TypeError", value: "boom" }] },
    };

    expect(dropNavigationErrors(event)).toBe(event);
  });

  it("passes through events with no exception data", () => {
    const event: ErrorEvent = { type: undefined, message: "scrape failed" };

    expect(dropNavigationErrors(event)).toBe(event);
  });
});
