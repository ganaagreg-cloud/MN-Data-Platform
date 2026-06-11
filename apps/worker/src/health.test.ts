import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock db before importing health module
vi.mock("@mn-platform/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { buildHealthPayload } from "./health.js";

describe("buildHealthPayload", () => {
  it("returns degraded when boss has not started", () => {
    const result = buildHealthPayload(
      { bossStarted: false, lastRunAt: null },
      0,
    );
    expect(result.status).toBe("degraded");
    expect(result.lastRunAt).toBeNull();
    expect(result.failedJobCount).toBe(0);
  });

  it("returns ok when boss has started", () => {
    const date = new Date("2026-06-10T08:00:00.000Z");
    const result = buildHealthPayload(
      { bossStarted: true, lastRunAt: date },
      3,
    );
    expect(result.status).toBe("ok");
    expect(result.lastRunAt).toBe("2026-06-10T08:00:00.000Z");
    expect(result.failedJobCount).toBe(3);
  });
});
