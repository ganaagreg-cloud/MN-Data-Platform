// apps/platform/src/lib/auth-tokens.test.ts
import { describe, it, expect } from "vitest";
import { generateAuthToken, AUTH_TOKEN_TTL_MS } from "./auth-tokens";

describe("generateAuthToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateAuthToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns a different token on each call", () => {
    expect(generateAuthToken()).not.toBe(generateAuthToken());
  });
});

describe("AUTH_TOKEN_TTL_MS", () => {
  it("is 5 minutes", () => {
    expect(AUTH_TOKEN_TTL_MS).toBe(5 * 60 * 1000);
  });
});
