// apps/worker/src/env.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "SENTRY_DSN",
  "NODE_ENV",
  "GIT_SHA",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
for (const key of ENV_KEYS) {
  const value = process.env[key];
  if (value !== undefined) original[key] = value;
}

// Required by the schema — set as valid defaults before each test, with
// individual tests deleting/overriding the var(s) they're exercising.
function setValidEnv(): void {
  process.env["SENTRY_DSN"] = "https://examplePublicKey@o0.ingest.sentry.io/0";
  process.env["TELEGRAM_BOT_TOKEN"] = "test-bot-token";
  process.env["TELEGRAM_CHAT_ID"] = "test-chat-id";
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  vi.resetModules();
});

describe("env", () => {
  it("throws when SENTRY_DSN is missing", async () => {
    setValidEnv();
    delete process.env["SENTRY_DSN"];

    await expect(import("./env.js")).rejects.toThrow();
  });

  it("throws when SENTRY_DSN is not a valid URL", async () => {
    setValidEnv();
    process.env["SENTRY_DSN"] = "not-a-url";

    await expect(import("./env.js")).rejects.toThrow();
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    setValidEnv();
    delete process.env["TELEGRAM_BOT_TOKEN"];

    await expect(import("./env.js")).rejects.toThrow();
  });

  it("throws when TELEGRAM_CHAT_ID is missing", async () => {
    setValidEnv();
    delete process.env["TELEGRAM_CHAT_ID"];

    await expect(import("./env.js")).rejects.toThrow();
  });

  it("parses a valid env and defaults NODE_ENV", async () => {
    setValidEnv();
    delete process.env["NODE_ENV"];
    delete process.env["GIT_SHA"];

    const { env } = await import("./env.js");

    expect(env.SENTRY_DSN).toBe("https://examplePublicKey@o0.ingest.sentry.io/0");
    expect(env.NODE_ENV).toBe("development");
    expect(env.GIT_SHA).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBe("test-bot-token");
    expect(env.TELEGRAM_CHAT_ID).toBe("test-chat-id");
  });

  it("passes through NODE_ENV and GIT_SHA when set", async () => {
    setValidEnv();
    process.env["NODE_ENV"] = "production";
    process.env["GIT_SHA"] = "abc123";

    const { env } = await import("./env.js");

    expect(env.NODE_ENV).toBe("production");
    expect(env.GIT_SHA).toBe("abc123");
  });
});
