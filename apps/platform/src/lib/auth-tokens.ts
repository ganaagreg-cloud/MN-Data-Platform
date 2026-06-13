// apps/platform/src/lib/auth-tokens.ts
import { randomBytes } from "node:crypto";

export const AUTH_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateAuthToken(): string {
  return randomBytes(16).toString("hex"); // 32 hex chars
}
