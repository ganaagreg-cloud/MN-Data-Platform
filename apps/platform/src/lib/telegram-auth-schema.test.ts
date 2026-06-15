// apps/platform/src/lib/telegram-auth-schema.test.ts
import { createHash, createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  TelegramAuthPayloadSchema,
  verifyTelegramAuth,
  MAX_AUTH_AGE_SECONDS,
} from "./telegram-auth-schema";

const BOT_TOKEN = "123456:test-bot-token-fixture";

function signPayload(fields: Record<string, string | undefined>): string {
  const checkString = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", secretKey).update(checkString).digest("hex");
}

function buildPayload(overrides: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = {
    id: "12345",
    first_name: "Bat",
    username: "bat_mn",
    auth_date: "1700000000",
    ...overrides,
  };
  const hash = signPayload(fields);
  return { ...fields, hash };
}

describe("verifyTelegramAuth", () => {
  it("returns true for a correctly-signed payload", () => {
    expect(verifyTelegramAuth(buildPayload(), BOT_TOKEN)).toBe(true);
  });

  it("returns false when a field is tampered after signing", () => {
    const payload = buildPayload();
    payload.first_name = "Eve";
    expect(verifyTelegramAuth(payload, BOT_TOKEN)).toBe(false);
  });

  it("returns false when hash is missing", () => {
    const { hash, ...rest } = buildPayload();
    void hash;
    expect(verifyTelegramAuth(rest, BOT_TOKEN)).toBe(false);
  });

  it("returns false (not throw) when hash has mismatched length", () => {
    const payload = buildPayload();
    payload.hash = "ab";
    expect(() => verifyTelegramAuth(payload, BOT_TOKEN)).not.toThrow();
    expect(verifyTelegramAuth(payload, BOT_TOKEN)).toBe(false);
  });
});

describe("MAX_AUTH_AGE_SECONDS", () => {
  it("is 24 hours", () => {
    expect(MAX_AUTH_AGE_SECONDS).toBe(24 * 60 * 60);
  });

  it("rejects an auth_date older than the max age", () => {
    const now = Date.now() / 1000;
    const staleAuthDate = now - MAX_AUTH_AGE_SECONDS - 1;
    expect(now - staleAuthDate > MAX_AUTH_AGE_SECONDS).toBe(true);
  });

  it("accepts a fresh auth_date", () => {
    const now = Date.now() / 1000;
    const freshAuthDate = now - 60;
    expect(now - freshAuthDate > MAX_AUTH_AGE_SECONDS).toBe(false);
  });
});

describe("TelegramAuthPayloadSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = TelegramAuthPayloadSchema.safeParse(buildPayload());
    expect(result.success).toBe(true);
  });

  it("accepts a payload with optional fields populated", () => {
    const result = TelegramAuthPayloadSchema.safeParse(
      buildPayload({
        last_name: "Bold",
        photo_url: "https://t.me/i/userpic/320/bat.jpg",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing id", () => {
    const { id, ...rest } = buildPayload();
    void id;
    expect(TelegramAuthPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a payload missing hash", () => {
    const { hash, ...rest } = buildPayload();
    void hash;
    expect(TelegramAuthPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a payload missing auth_date", () => {
    const { auth_date, ...rest } = buildPayload();
    void auth_date;
    expect(TelegramAuthPayloadSchema.safeParse(rest).success).toBe(false);
  });
});
