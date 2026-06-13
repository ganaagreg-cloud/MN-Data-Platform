// apps/platform/src/lib/session.test.ts
import { describe, it, expect } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";
process.env["TELEGRAM_BOT_TOKEN"] ??= "test-bot-token";
process.env["BOT_USERNAME"] ??= "TestBot";
process.env["SESSION_SECRET"] ??= "a".repeat(32);

const { createSessionToken, verifySessionToken, sign } = await import("./session");

describe("createSessionToken / verifySessionToken", () => {
  it("round-trips a userId", () => {
    const token = createSessionToken("user-123");
    expect(verifySessionToken(token)).toBe("user-123");
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken("user-123");
    const [payload, sig] = token.split(".");
    const tampered = `${payload}.${sig!.split("").reverse().join("")}`;
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken("not-a-token")).toBeNull();
  });

  it("rejects an expired token even with a valid signature", () => {
    const payload = `user-123.${Date.now() - 1000}`;
    const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
    expect(verifySessionToken(token)).toBeNull();
  });
});
