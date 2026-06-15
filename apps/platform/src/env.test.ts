// apps/platform/src/env.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "TELEGRAM_BOT_TOKEN",
  "BOT_USERNAME",
  "AUTH_SECRET",
  "ADMIN_TELEGRAM_IDS",
  "NODE_ENV",
] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
for (const key of ENV_KEYS) {
  const value = process.env[key];
  if (value !== undefined) original[key] = value;
}

// Next.js's global types declare `process.env.NODE_ENV` as a readonly
// literal union, so restoring/deleting it below needs a mutable view.
const mutableEnv = process.env as Record<string, string | undefined>;

function setValidEnv(): void {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["DATABASE_URL_DIRECT"] = "postgres://test:test@localhost:5432/test";
  process.env["TELEGRAM_BOT_TOKEN"] = "test-bot-token";
  process.env["BOT_USERNAME"] = "TestBot";
  process.env["AUTH_SECRET"] = "x".repeat(32);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = original[key];
  }
  vi.resetModules();
});

describe("env", () => {
  it("throws when DATABASE_URL_DIRECT is missing", async () => {
    setValidEnv();
    delete process.env["DATABASE_URL_DIRECT"];

    await expect(import("./env")).rejects.toThrow();
  });

  it("throws when BOT_USERNAME is missing", async () => {
    setValidEnv();
    delete process.env["BOT_USERNAME"];

    await expect(import("./env")).rejects.toThrow();
  });

  it("throws when AUTH_SECRET is shorter than 32 characters", async () => {
    setValidEnv();
    process.env["AUTH_SECRET"] = "too-short";

    await expect(import("./env")).rejects.toThrow();
  });

  it("parses a valid env and defaults NODE_ENV", async () => {
    setValidEnv();
    delete mutableEnv["NODE_ENV"];
    delete mutableEnv["ADMIN_TELEGRAM_IDS"];

    const { env } = await import("./env");

    expect(env.BOT_USERNAME).toBe("TestBot");
    expect(env.NODE_ENV).toBe("development");
    expect(env.ADMIN_TELEGRAM_IDS).toBe("");
  });
});

describe("isAdminTelegramId", () => {
  it("returns false for everyone when ADMIN_TELEGRAM_IDS is empty", async () => {
    setValidEnv();
    delete mutableEnv["ADMIN_TELEGRAM_IDS"];

    const { isAdminTelegramId } = await import("./env");

    expect(isAdminTelegramId(12345)).toBe(false);
    expect(isAdminTelegramId(null)).toBe(false);
    expect(isAdminTelegramId(undefined)).toBe(false);
  });

  it("returns true only for IDs listed in ADMIN_TELEGRAM_IDS", async () => {
    setValidEnv();
    process.env["ADMIN_TELEGRAM_IDS"] = "111, 222";

    const { isAdminTelegramId } = await import("./env");

    expect(isAdminTelegramId(111)).toBe(true);
    expect(isAdminTelegramId(222)).toBe(true);
    expect(isAdminTelegramId(333)).toBe(false);
  });
});
