import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramPayload, TELEGRAM_FIELDS } from "./telegram-auth";
import type { TelegramUser } from "./telegram-auth";

const testHmacKey = "hmac-test-key-not-a-real-secret";

function buildPayload(
  overrides: Partial<Record<keyof TelegramUser, string | number>> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: 123456789,
    first_name: "Ганаа",
    username: "ganaa",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };

  const checkParts = Object.entries(base)
    .filter(
      ([k, v]) =>
        k !== "hash" &&
        TELEGRAM_FIELDS.has(k) &&
        v !== undefined &&
        v !== null &&
        v !== "",
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);

  const secretKey = createHash("sha256").update(testHmacKey).digest();
  base["hash"] = createHmac("sha256", secretKey)
    .update(checkParts.join("\n"))
    .digest("hex");

  return base;
}

describe("verifyTelegramPayload", () => {
  it("returns TelegramUser for a valid payload", () => {
    const payload = buildPayload();
    const result = verifyTelegramPayload(payload, testHmacKey);
    expect(result.id).toBe(123456789);
    expect(result.first_name).toBe("Ганаа");
    expect(result.username).toBe("ganaa");
    expect(result.auth_date).toBeTypeOf("number");
  });

  it("returns optional fields when present", () => {
    const payload = buildPayload({
      last_name: "Баяр",
      photo_url: "https://t.me/photo.jpg",
    });
    const result = verifyTelegramPayload(payload, testHmacKey);
    expect(result.last_name).toBe("Баяр");
    expect(result.photo_url).toBe("https://t.me/photo.jpg");
  });

  it("throws on tampered hash", () => {
    const payload = buildPayload();
    payload["hash"] = "deadbeef".repeat(8);
    expect(() => verifyTelegramPayload(payload, testHmacKey)).toThrow("Hash mismatch");
  });

  it("throws when auth_date is older than 24 hours", () => {
    const staleDate = Math.floor(Date.now() / 1000) - 86401;
    const payload = buildPayload({ auth_date: staleDate });
    expect(() => verifyTelegramPayload(payload, testHmacKey)).toThrow("Auth data expired");
  });

  it("throws when first_name is missing", () => {
    const payload = buildPayload({ first_name: "" });
    expect(() => verifyTelegramPayload(payload, testHmacKey)).toThrow("Missing first_name");
  });

  it("ignores unknown extra fields when computing hash", () => {
    const payload = buildPayload();
    payload["redirect"] = "false";
    payload["csrfToken"] = "abc";
    expect(() => verifyTelegramPayload(payload, testHmacKey)).not.toThrow();
  });

  it("throws on non-hex hash string", () => {
    const payload = buildPayload();
    payload["hash"] = "not-valid-hex!!".padEnd(64, "!");
    expect(() => verifyTelegramPayload(payload, testHmacKey)).toThrow("Hash mismatch");
  });

  it("throws when auth_date is in the future", () => {
    const futureDate = Math.floor(Date.now() / 1000) + 3600;
    const payload = buildPayload({ auth_date: futureDate });
    expect(() => verifyTelegramPayload(payload, testHmacKey)).toThrow("Auth data expired");
  });
});
