// packages/core/src/crawlbase.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getMock, CrawlingAPIMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const CrawlingAPIMock = vi.fn().mockImplementation(() => ({ get: getMock }));
  return { getMock, CrawlingAPIMock };
});

vi.mock("crawlbase", () => ({
  CrawlingAPI: CrawlingAPIMock,
}));

import { fetchRenderedHtml } from "./crawlbase.js";

describe("fetchRenderedHtml", () => {
  const originalToken = process.env["CRAWLBASE_TOKEN"];

  beforeEach(() => {
    process.env["CRAWLBASE_TOKEN"] = "test-token";
    getMock.mockReset();
    CrawlingAPIMock.mockClear();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["CRAWLBASE_TOKEN"];
    else process.env["CRAWLBASE_TOKEN"] = originalToken;
  });

  it("throws when CRAWLBASE_TOKEN is missing", async () => {
    delete process.env["CRAWLBASE_TOKEN"];

    await expect(fetchRenderedHtml("https://example.com")).rejects.toThrow(
      "Missing required environment variable: CRAWLBASE_TOKEN",
    );
    expect(CrawlingAPIMock).not.toHaveBeenCalled();
  });

  it("throws when Crawlbase responds with a non-200 status", async () => {
    getMock.mockResolvedValue({ statusCode: 503, body: "" });

    await expect(fetchRenderedHtml("https://example.com")).rejects.toThrow(
      "Crawlbase request failed for https://example.com: status 503",
    );
  });

  it("returns the response body on a 200 status, forwarding options", async () => {
    getMock.mockResolvedValue({ statusCode: 200, body: "<html>ok</html>" });

    const html = await fetchRenderedHtml("https://example.com", {
      pageWaitMs: 3000,
      userAgent: "TestAgent/1.0",
    });

    expect(html).toBe("<html>ok</html>");
    expect(CrawlingAPIMock).toHaveBeenCalledWith({ token: "test-token" });
    expect(getMock).toHaveBeenCalledWith("https://example.com", {
      page_wait: 3000,
      userAgent: "TestAgent/1.0",
    });
  });

  it("omits optional fields from the request when not provided", async () => {
    getMock.mockResolvedValue({ statusCode: 200, body: "<html>ok</html>" });

    await fetchRenderedHtml("https://example.com");

    expect(getMock).toHaveBeenCalledWith("https://example.com", {});
  });
});
