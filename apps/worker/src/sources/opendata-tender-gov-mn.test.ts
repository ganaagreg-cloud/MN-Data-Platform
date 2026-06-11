import { describe, it, expect, afterEach } from "vitest";
import { openDataTenderSource } from "./opendata-tender-gov-mn.js";

describe("openDataTenderSource", () => {
  const originalToken = process.env["OPENDATA_BEARER_TOKEN"];

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["OPENDATA_BEARER_TOKEN"];
    } else {
      process.env["OPENDATA_BEARER_TOKEN"] = originalToken;
    }
  });

  it("has source_id tender.gov.mn", () => {
    expect(openDataTenderSource.id).toBe("tender.gov.mn");
  });

  it("throws a clear error when OPENDATA_BEARER_TOKEN is not set", async () => {
    delete process.env["OPENDATA_BEARER_TOKEN"];
    await expect(openDataTenderSource.fetchPage()).rejects.toThrow(
      "OPENDATA_BEARER_TOKEN",
    );
  });

  it("throws not-implemented when token is set (stub)", async () => {
    process.env["OPENDATA_BEARER_TOKEN"] = "test-token";
    await expect(openDataTenderSource.fetchPage()).rejects.toThrow(
      "not yet implemented",
    );
  });
});
