# Telegram Bot Deep-Link Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-only login for `apps/platform` (GazarPrice route group) via the bot deep-link flow — no password, no OTP, no email.

**Architecture:** Extend the existing `users` table (org_id/email become nullable) instead of a parallel identity table; add an `auth_tokens` table for the login handshake. `/login` generates a token + deep link and polls a server action; the bot webhook claims the token on `/start auth_<token>` and upserts the user; an HMAC-signed httpOnly cookie holds the session.

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions), Drizzle ORM, Zod, `node:crypto` (HMAC), Vitest. Spec: `docs/superpowers/specs/2026-06-13-telegram-auth-design.md`.

---

### Task 1: Extend `users` + add `auth_tokens` schema, generate migration

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Generate: `packages/db/migrations/0005_*.sql`, `packages/db/migrations/meta/0005_snapshot.json`, `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Edit the schema**

In `packages/db/src/schema/index.ts`, update the import list (add `bigint`, `boolean`):

```ts
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
```

Replace the `users` table (lines 26-44) with:

```ts
// ── users ─────────────────────────────────────────────────────────────────────
// org_id/email are nullable: Telegram-only users have neither until they're
// added to an org (B2B overlay) or set an email. telegram_id is the identity
// for the bot deep-link login flow (see auth_tokens below).
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id),
    email: text("email"),
    name: text("name"),
    telegramId: bigint("telegram_id", { mode: "number" }),
    telegramUsername: text("telegram_username"),
    firstName: text("first_name"),
    telegramChatId: text("telegram_chat_id"),
    phone: text("phone"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_org_id_idx").on(t.orgId),
  ],
);
```

Add a new `auth_tokens` table at the end of the file (after `notificationsSent`):

```ts
// ── auth_tokens ──────────────────────────────────────────────────────────────
// Login handshake for the Telegram bot deep-link flow. token is the random
// 32-char hex value embedded in t.me/{BOT_USERNAME}?start=auth_{token}; the
// webhook attaches telegram_id and sets consumed=true once claimed.
export const authTokens = pgTable("auth_tokens", {
  token: text("token").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumed: boolean("consumed").notNull().default(false),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`

This should produce `packages/db/migrations/0005_<auto-name>.sql` plus updated `meta/0005_snapshot.json` and `meta/_journal.json`. Open the generated SQL and confirm it contains (statement order may differ):

```sql
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "telegram_id" bigint;
ALTER TABLE "users" ADD COLUMN "telegram_username" text;
ALTER TABLE "users" ADD COLUMN "first_name" text;
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;
CREATE UNIQUE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");

CREATE TABLE "auth_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
```

If drizzle-kit names the migration file something other than `0005_<name>.sql`, that's fine — just note the actual filename for later reference. Do not hand-edit the generated `meta/*.json` snapshot files.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @mn-platform/db typecheck`
Expected: PASS (0 errors)

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(db): extend users for Telegram identity, add auth_tokens table"
```

---

### Task 2: `sendTelegramMessageTo(chatId, text)` in `packages/core`

**Files:**
- Modify: `packages/core/src/notifications/telegram.ts`
- Modify: `packages/core/src/notifications/telegram.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/notifications/telegram.test.ts`, add `sendTelegramMessageTo` to the import on line 3-7:

```ts
import {
  sendTelegramMessage,
  sendTelegramMessageTo,
  formatListingAlert,
  formatTenderAlert,
} from "./telegram.js";
```

Add a new `describe` block after the closing `});` of `describe("sendTelegramMessage", ...)` (end of file):

```ts
describe("sendTelegramMessageTo", () => {
  const originalToken = process.env["TELEGRAM_BOT_TOKEN"];

  beforeEach(() => {
    process.env["TELEGRAM_BOT_TOKEN"] = "test-token";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["TELEGRAM_BOT_TOKEN"];
    else process.env["TELEGRAM_BOT_TOKEN"] = originalToken;
    vi.unstubAllGlobals();
  });

  it("POSTs to the given chatId using TELEGRAM_BOT_TOKEN", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessageTo(987654321, "hi there");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      chat_id: 987654321,
      text: "hi there",
      parse_mode: "HTML",
    });
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageTo(123, "hi")).rejects.toThrow("TELEGRAM_BOT_TOKEN must be set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the Telegram API responds with a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageTo(123, "hi")).rejects.toThrow("Telegram sendMessage failed: 403 Forbidden");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mn-platform/core test`
Expected: FAIL — `sendTelegramMessageTo` is not exported from `./telegram.js`

- [ ] **Step 3: Implement `sendTelegramMessageTo`**

In `packages/core/src/notifications/telegram.ts`, replace the existing `sendTelegramMessage` function (lines 14-41) with:

```ts
/**
 * POSTs a message to an arbitrary Telegram chat via the bot identified by
 * TELEGRAM_BOT_TOKEN (read from process.env). Rejects if the token is
 * missing or the Telegram API responds with a non-2xx status.
 */
export async function sendTelegramMessageTo(chatId: string | number, text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN must be set");
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

/**
 * POSTs a message to TELEGRAM_CHAT_ID via the bot identified by
 * TELEGRAM_BOT_TOKEN (both read from process.env). Rejects if either env
 * var is missing or the Telegram API responds with a non-2xx status.
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
  }

  return sendTelegramMessageTo(chatId, text);
}
```

This keeps `sendTelegramMessage`'s existing error message and behavior exactly as before (regression-safe for the existing test in the same file), while `sendTelegramMessageTo` is the new general-purpose primitive used by the auth webhook.

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

Change line 7:

```ts
export { sendTelegramMessage, sendTelegramMessageTo, formatListingAlert, formatTenderAlert } from "./notifications/telegram.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mn-platform/core test`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @mn-platform/core typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/notifications/telegram.ts packages/core/src/notifications/telegram.test.ts packages/core/src/index.ts
git commit -m "feat(core): add sendTelegramMessageTo for arbitrary-chat messages"
```

---

### Task 3: Fix `apps/worker/src/alerts` for nullable `org_id`/`email`

**Files:**
- Modify: `apps/worker/src/alerts/types.ts`
- Modify: `apps/worker/src/alerts/dispatch.ts`
- Modify: `apps/worker/src/alerts/providers/email.ts`
- Modify: `apps/worker/src/alerts/dispatch.test.ts`

Task 1 made `users.org_id` and `users.email` nullable. `dispatch.ts` currently does `eq(subscriptions.orgId, user.orgId)` (breaks if `orgId` is `string | null`) and builds `recipient.email: user.email` unconditionally (breaks `Recipient.email: string`).

- [ ] **Step 1: Write the failing tests**

In `apps/worker/src/alerts/dispatch.test.ts`, add two new `it` blocks inside `describe("dispatchAlert", ...)`, after the existing `"returns without dispatching when subscription is inactive"` test (before the closing `});` of the describe block):

```ts
  it("skips dispatch entirely when the user has no org", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "user-1", orgId: null, email: "test@example.com", telegramChatId: null, phone: null,
    });

    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(insertNotificationSent).not.toHaveBeenCalled();
  });

  it("skips the email channel when user.email is null, but still dispatches other channels", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "user-1", orgId: "org-1", email: null, telegramChatId: "chat-1", phone: null,
    });
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "active",
      alertChannels: ["email", "telegram"], modules: ["tender"],
    });

    const emailProvider = makeProvider("email");
    const telegramProvider = makeProvider("telegram");
    await dispatchAlert(payload, [emailProvider, telegramProvider]);

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(telegramProvider.send).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mn-platform/worker test -- dispatch`
Expected: FAIL — first new test fails because `dispatchAlert` still calls `eq(subscriptions.orgId, null)` and proceeds (no early-return for null org); second fails because the email provider is still called with `recipient.email === null`.

- [ ] **Step 3: Update `Recipient.email` to optional**

In `apps/worker/src/alerts/types.ts`, change line 13:

```ts
export interface Recipient {
  userId: string;
  email?: string;
  telegramChatId?: string;
  phone?: string;
}
```

- [ ] **Step 4: Guard against null `org_id` and `email` in `dispatch.ts`**

In `apps/worker/src/alerts/dispatch.ts`, after the `if (!user) { ... return; }` block (after line 19), add:

```ts

  // Extract to a local const so the non-null narrowing persists across the
  // `await` below (narrowing a nested property like `user.orgId` directly
  // does not reliably survive an await).
  const orgId = user.orgId;
  if (!orgId) {
    logger.warn({ userId: payload.userId }, "dispatchAlert: user has no org — skipping");
    return;
  }
```

Then update the subscription lookup (lines 22-26) to use `orgId` instead of `user.orgId`:

```ts
  // Step 1b: load subscription for user's org
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.orgId, orgId),
    ),
  });
```

Replace the recipient construction (lines 53-59):

```ts
  // Step 5: build recipient (exactOptionalPropertyTypes — omit absent fields)
  const recipient: import("./types.js").Recipient = {
    userId: user.id,
    email:  user.email,
    ...(user.telegramChatId != null && { telegramChatId: user.telegramChatId }),
    ...(user.phone          != null && { phone:          user.phone }),
  };
```

with:

```ts
  // Step 5: build recipient (exactOptionalPropertyTypes — omit absent fields)
  const recipient: import("./types.js").Recipient = {
    userId: user.id,
    ...(user.email          != null && { email:          user.email }),
    ...(user.telegramChatId != null && { telegramChatId: user.telegramChatId }),
    ...(user.phone          != null && { phone:          user.phone }),
  };
```

Add an email channel gate alongside the existing telegram gate (lines 71-75):

```ts
    // Channel gates
    if (channel === "email" && !recipient.email) {
      logger.info({ userId: user.id }, "dispatchAlert: email not set — skipping email");
      continue;
    }
    if (channel === "telegram" && !recipient.telegramChatId) {
      logger.info({ userId: user.id }, "dispatchAlert: telegram_chat_id not set — skipping telegram");
      continue;
    }
```

- [ ] **Step 5: Defensive check in `ResendEmailProvider.send`**

In `apps/worker/src/alerts/providers/email.ts`, add a guard at the top of `send` (line 14):

```ts
  async send(notification: Notification, recipient: Recipient): Promise<void> {
    if (!recipient.email) {
      throw new Error("ResendEmailProvider: recipient.email is required");
    }

    const html = `
```

(rest of the function body unchanged — `to: recipient.email` on line 25 now narrows to `string`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @mn-platform/worker test -- dispatch`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm --filter @mn-platform/worker typecheck && pnpm --filter @mn-platform/worker lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/alerts/types.ts apps/worker/src/alerts/dispatch.ts apps/worker/src/alerts/providers/email.ts apps/worker/src/alerts/dispatch.test.ts
git commit -m "fix(worker): handle nullable users.org_id/email in alert dispatch"
```

---

### Task 4: `apps/platform` scaffolding — deps, vitest

**Files:**
- Modify: `apps/platform/package.json`
- Create: `apps/platform/vitest.config.ts`

- [ ] **Step 1: Edit `apps/platform/package.json`**

Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`, add `drizzle-orm` and `zod` to `dependencies`, and `vitest` to `devDependencies`:

```json
{
  "name": "@mn-platform/platform",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mn-platform/core": "workspace:*",
    "@mn-platform/db": "workspace:*",
    "@mn-platform/mn": "workspace:*",
    "drizzle-orm": "^0.41.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/platform/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: lockfile updates for `apps/platform`, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/platform/package.json apps/platform/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(platform): add drizzle-orm, zod, vitest"
```

---

### Task 5: `apps/platform/src/env.ts`

**Files:**
- Create: `apps/platform/src/env.ts`
- Create: `apps/platform/src/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/platform/src/env.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "TELEGRAM_BOT_TOKEN",
  "BOT_USERNAME",
  "SESSION_SECRET",
  "NODE_ENV",
] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
for (const key of ENV_KEYS) {
  const value = process.env[key];
  if (value !== undefined) original[key] = value;
}

function setValidEnv(): void {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["DATABASE_URL_DIRECT"] = "postgres://test:test@localhost:5432/test";
  process.env["TELEGRAM_BOT_TOKEN"] = "test-bot-token";
  process.env["BOT_USERNAME"] = "TestBot";
  process.env["SESSION_SECRET"] = "x".repeat(32);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
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

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    setValidEnv();
    process.env["SESSION_SECRET"] = "too-short";

    await expect(import("./env")).rejects.toThrow();
  });

  it("parses a valid env and defaults NODE_ENV", async () => {
    setValidEnv();
    delete process.env["NODE_ENV"];

    const { env } = await import("./env");

    expect(env.BOT_USERNAME).toBe("TestBot");
    expect(env.NODE_ENV).toBe("development");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mn-platform/platform test -- env`
Expected: FAIL — `Cannot find module './env'`

- [ ] **Step 3: Implement `env.ts`**

```ts
// apps/platform/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Required by @mn-platform/db's client.ts (migrationDb) at import time,
  // even though apps/platform never runs migrations directly.
  DATABASE_URL_DIRECT: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Bare bot username, WITHOUT a leading "@" — used to build t.me/{BOT_USERNAME}?start=...
  BOT_USERNAME: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mn-platform/platform test -- env`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/platform/src/env.ts apps/platform/src/env.test.ts
git commit -m "feat(platform): add env schema"
```

---

### Task 6: `apps/platform/src/lib/auth-tokens.ts`

**Files:**
- Create: `apps/platform/src/lib/auth-tokens.ts`
- Create: `apps/platform/src/lib/auth-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mn-platform/platform test -- auth-tokens`
Expected: FAIL — `Cannot find module './auth-tokens'`

- [ ] **Step 3: Implement `auth-tokens.ts`**

```ts
// apps/platform/src/lib/auth-tokens.ts
import { randomBytes } from "node:crypto";

export const AUTH_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateAuthToken(): string {
  return randomBytes(16).toString("hex"); // 32 hex chars
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mn-platform/platform test -- auth-tokens`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/platform/src/lib/auth-tokens.ts apps/platform/src/lib/auth-tokens.test.ts
git commit -m "feat(platform): add auth token generator"
```

---

### Task 7: `apps/platform/src/lib/session.ts`

**Files:**
- Create: `apps/platform/src/lib/session.ts`
- Create: `apps/platform/src/lib/session.test.ts`

Depends on Task 5 (`env.ts`, for `SESSION_SECRET`/`NODE_ENV`).

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mn-platform/platform test -- session`
Expected: FAIL — `Cannot find module './session'`

- [ ] **Step 3: Implement `session.ts`**

```ts
// apps/platform/src/lib/session.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "../env";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  const [userId, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (!userId || !exp || Date.now() > exp) return null;
  return userId;
}

export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<{ userId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  return userId ? { userId } : null;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mn-platform/platform test -- session`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/platform/src/lib/session.ts apps/platform/src/lib/session.test.ts
git commit -m "feat(platform): add HMAC-signed session cookie helpers"
```

---

### Task 8: Env additions — `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Edit `.env.example`**

Add `DATABASE_URL_DIRECT=` after `DATABASE_URL=`, and `BOT_USERNAME=` + `SESSION_SECRET=` after `TELEGRAM_CHAT_ID=`:

```
DATABASE_URL=
DATABASE_URL_DIRECT=
QPAY_USERNAME=
QPAY_PASSWORD=
RESEND_API_KEY=
SENTRY_DSN=
GITHUB_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
BOT_USERNAME=
SESSION_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: document DATABASE_URL_DIRECT, BOT_USERNAME, SESSION_SECRET"
```

---

### Task 9: Telegram webhook route

**Files:**
- Create: `apps/platform/src/app/api/telegram/webhook/route.ts`
- Create: `apps/platform/src/app/api/telegram/webhook/route.test.ts`

Depends on Task 1 (`authTokens`, `users` schema), Task 2 (`sendTelegramMessageTo`), Task 4 (vitest).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/platform/src/app/api/telegram/webhook/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";
process.env["TELEGRAM_BOT_TOKEN"] ??= "test-bot-token";
process.env["BOT_USERNAME"] ??= "TestBot";
process.env["SESSION_SECRET"] ??= "a".repeat(32);

const findFirstAuthTokens = vi.fn();
const findFirstUsers = vi.fn();
const updateSet = vi.fn();
const updateWhere = vi.fn();
const insertValues = vi.fn();

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: {
      query: {
        authTokens: { findFirst: findFirstAuthTokens },
        users: { findFirst: findFirstUsers },
      },
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    },
  };
});

const sendTelegramMessageTo = vi.fn().mockResolvedValue(undefined);
vi.mock("@mn-platform/core", () => ({ sendTelegramMessageTo }));

const { POST } = await import("./route");

function makeRequest(body: unknown): Request {
  return new Request("https://example.com/api/telegram/webhook", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_TOKEN = "a".repeat(32);

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
    insertValues.mockResolvedValue(undefined);
  });

  it("upserts a new user and marks the token consumed for a valid /start auth_<token>", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: null,
      consumed: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    findFirstUsers.mockResolvedValue(undefined);

    const res = await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith({
      telegramId: 999,
      telegramUsername: "ganaa",
      firstName: "Ганаа",
      lastLoginAt: expect.any(Date),
    });
    expect(updateSet).toHaveBeenCalledWith({ telegramId: 999, consumed: true });
    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("Амжилттай"));
  });

  it("updates the existing user when telegram_id already exists", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: null,
      consumed: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    findFirstUsers.mockResolvedValue({ id: "user-1", telegramId: 999 });

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ lastLoginAt: expect.any(Date) }));
  });

  it("replies with an expired message and does not touch the DB for a consumed token", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: 111,
      consumed: true,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("дууссан"));
  });

  it("replies with an expired message for an unknown token", async () => {
    findFirstAuthTokens.mockResolvedValue(undefined);

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999 },
      },
    }));

    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("дууссан"));
  });

  it("sends a generic reply for /start without a token", async () => {
    await POST(makeRequest({
      message: {
        text: "/start",
        chat: { id: 555 },
        from: { id: 999 },
      },
    }));

    expect(findFirstAuthTokens).not.toHaveBeenCalled();
    expect(sendTelegramMessageTo).toHaveBeenCalledOnce();
  });

  it("returns 200 without dispatching for a body with no message", async () => {
    const res = await POST(makeRequest({ not: "a telegram update" }));

    expect(res.status).toBe(200);
    expect(sendTelegramMessageTo).not.toHaveBeenCalled();
  });

  it("returns 200 even when the request body is not valid JSON", async () => {
    const req = new Request("https://example.com/api/telegram/webhook", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mn-platform/platform test -- webhook`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implement the webhook route**

```ts
// apps/platform/src/app/api/telegram/webhook/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, authTokens } from "@mn-platform/db";
import { sendTelegramMessageTo } from "@mn-platform/core";

const TelegramUpdateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
      from: z.object({
        id: z.number(),
        username: z.string().optional(),
        first_name: z.string().optional(),
      }),
    })
    .optional(),
});

const AUTH_START_RE = /^\/start auth_([a-f0-9]{32})$/;

interface TelegramFrom {
  id: number;
  username?: string;
  first_name?: string;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const update = TelegramUpdateSchema.parse(await req.json());
    const message = update.message;
    const text = message?.text;

    if (message && text) {
      const match = AUTH_START_RE.exec(text);
      if (match) {
        await handleAuthStart(match[1]!, message.from, message.chat.id);
      } else if (text.startsWith("/start")) {
        await sendTelegramMessageTo(
          message.chat.id,
          "Тавтай морил! Нэвтрэхийн тулд вэб хуудас руу буцаж, холбоос дээр дарна уу.",
        );
      }
    }
  } catch (err) {
    console.error("telegram webhook error", err);
  }

  // Always 200 — non-2xx makes Telegram retry the same update.
  return NextResponse.json({ ok: true });
}

async function handleAuthStart(token: string, from: TelegramFrom, chatId: number): Promise<void> {
  const tokenRow = await db.query.authTokens.findFirst({ where: eq(authTokens.token, token) });

  if (!tokenRow || tokenRow.consumed || tokenRow.expiresAt < new Date()) {
    await sendTelegramMessageTo(chatId, "Холбоосын хугацаа дууссан. Вэб хуудсыг шинэчлээд дахин оролдоно уу.");
    return;
  }

  const existing = await db.query.users.findFirst({ where: eq(users.telegramId, from.id) });
  const fields = {
    telegramUsername: from.username ?? null,
    firstName: from.first_name ?? null,
    lastLoginAt: new Date(),
  };

  if (existing) {
    await db.update(users).set(fields).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ telegramId: from.id, ...fields });
  }

  await db.update(authTokens).set({ telegramId: from.id, consumed: true }).where(eq(authTokens.token, token));
  await sendTelegramMessageTo(chatId, "Амжилттай нэвтэрлээ! Вэб рүү буцна уу.");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mn-platform/platform test -- webhook`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/platform/src/app/api/telegram/webhook/
git commit -m "feat(platform): add Telegram bot webhook for deep-link auth"
```

---

### Task 10: Login page, poller, server action, dashboard stub

**Files:**
- Create: `apps/platform/src/app/(gazar)/login/page.tsx`
- Create: `apps/platform/src/app/(gazar)/login/actions.ts`
- Create: `apps/platform/src/app/(gazar)/login/login-poller.tsx`
- Create: `apps/platform/src/app/(gazar)/dashboard/page.tsx`

Depends on Task 1, 5, 6, 7. No dedicated unit tests — covered by typecheck/lint plus manual verification (Step 6). Adding `jsdom`/React Testing Library for these client/server components is out of scope for this plan.

- [ ] **Step 1: Server action — `actions.ts`**

```ts
// apps/platform/src/app/(gazar)/login/actions.ts
"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, authTokens, users } from "@mn-platform/db";
import { setSession } from "@/lib/session";

export type LoginStatus = "pending" | "expired";

export async function checkLoginStatus(token: string): Promise<LoginStatus> {
  const tokenRow = await db.query.authTokens.findFirst({ where: eq(authTokens.token, token) });

  if (!tokenRow || tokenRow.expiresAt < new Date()) return "expired";
  if (!tokenRow.consumed) return "pending";

  // Local const so the non-null narrowing survives the `await` below.
  const telegramId = tokenRow.telegramId;
  if (telegramId == null) return "pending";

  const user = await db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });
  if (!user) return "expired"; // shouldn't happen — webhook upserts before marking consumed

  await setSession(user.id);
  redirect("/dashboard");
}
```

- [ ] **Step 2: Client poller — `login-poller.tsx`**

```tsx
// apps/platform/src/app/(gazar)/login/login-poller.tsx
"use client";

import { useEffect, useState } from "react";
import { checkLoginStatus } from "./actions";

const POLL_INTERVAL_MS = 2000;

export function LoginPoller({ token }: { token: string }) {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      void checkLoginStatus(token).then((status) => {
        if (status === "expired") {
          setExpired(true);
          clearInterval(interval);
        }
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [token]);

  if (expired) {
    return <p>Холбоосын хугацаа дууссан. Хуудсыг шинэчлээд дахин оролдоно уу.</p>;
  }

  return <p>Telegram-д баталгаажуулахыг хүлээж байна…</p>;
}
```

- [ ] **Step 3: Login page — `page.tsx`**

```tsx
// apps/platform/src/app/(gazar)/login/page.tsx
import { redirect } from "next/navigation";
import { db, authTokens } from "@mn-platform/db";
import { env } from "@/env";
import { getSession } from "@/lib/session";
import { AUTH_TOKEN_TTL_MS, generateAuthToken } from "@/lib/auth-tokens";
import { LoginPoller } from "./login-poller";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const token = generateAuthToken();
  await db.insert(authTokens).values({
    token,
    expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS),
  });

  const deepLink = `https://t.me/${env.BOT_USERNAME}?start=auth_${token}`;

  return (
    <main>
      <h1>Нэвтрэх</h1>
      <p>Telegram ашиглан нэвтэрнэ үү.</p>
      <a href={deepLink}>Telegram-ээр нэвтрэх</a>
      <LoginPoller token={token} />
    </main>
  );
}
```

- [ ] **Step 4: Dashboard stub — `dashboard/page.tsx`**

```tsx
// apps/platform/src/app/(gazar)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users } from "@mn-platform/db";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });

  return (
    <main>
      <h1>Тавтай морил, {user?.firstName ?? user?.telegramUsername ?? "хэрэглэгч"}!</h1>
    </main>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @mn-platform/platform typecheck && pnpm --filter @mn-platform/platform lint`
Expected: PASS

- [ ] **Step 6: Manual verification**

This step requires real Telegram credentials and a public URL, so it's a manual follow-up rather than part of automated CI:

1. Set `DATABASE_URL`, `DATABASE_URL_DIRECT`, `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `SESSION_SECRET` (32+ random chars) in `.env`.
2. Apply migration 0005: `pnpm db:migrate`.
3. Start a tunnel (e.g. `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`) and note the HTTPS URL.
4. Register the webhook once:
   ```bash
   curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${PUBLIC_URL}/api/telegram/webhook"
   ```
5. Run `pnpm --filter @mn-platform/platform dev`, open `/login`, tap "Telegram-ээр нэвтрэх", confirm in Telegram, and verify the page redirects to `/dashboard` within ~2-4 seconds showing your Telegram first name.
6. Reload `/login` after 5+ minutes without completing it and confirm the poller shows the expired message.

- [ ] **Step 7: Commit**

```bash
git add "apps/platform/src/app/(gazar)/"
git commit -m "feat(platform): add Telegram deep-link login page and dashboard stub"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Auth stack line**

In the **Stack** section, replace:

```
- **Auth:** Auth.js (B2B email/password + org accounts).
```

with:

```
- **Auth:** Telegram bot deep-link login (no password/OTP/email) is the primary auth for `apps/platform` — see `docs/superpowers/specs/2026-06-13-telegram-auth-design.md`. `users.org_id`/`email` are nullable and used only for the optional B2B overlay (Auth.js email/password + org accounts is deferred until that overlay is built).
```

- [ ] **Step 2: Update the Progress log**

Append a new line under `## Progress`:

```
- [x] Telegram bot deep-link auth — users table extended (telegram_id/telegram_username/first_name/last_login_at, org_id/email nullable), new auth_tokens table (migration 0005). packages/core gained sendTelegramMessageTo(chatId, text). apps/worker/src/alerts/dispatch.ts handles null org_id (early-return) and null email (per-channel gate); ResendEmailProvider defends recipient.email. apps/platform gained env.ts (BOT_USERNAME, SESSION_SECRET, DATABASE_URL_DIRECT), lib/session.ts (HMAC cookie), lib/auth-tokens.ts, app/api/telegram/webhook/route.ts, app/(gazar)/login (page + poller + checkLoginStatus action), app/(gazar)/dashboard stub. Webhook registration + end-to-end flow require manual setWebhook (see plan Task 10 Step 6) — not yet run against a real bot.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record Telegram deep-link auth in CLAUDE.md"
```

---

## Definition of Done

- [ ] `pnpm typecheck` passes across all touched packages (no `any`).
- [ ] `pnpm lint` passes.
- [ ] Migration 0005 applies cleanly on top of 0004.
- [ ] Re-running `/start auth_<token>` for an already-consumed token is idempotent (no duplicate user, no re-claim) — covered by Task 9 tests.
- [ ] Every webhook payload is validated by `TelegramUpdateSchema` before any DB write.
- [ ] No secrets logged; `SESSION_SECRET` only read via `env.ts`.
- [ ] Session cookie is httpOnly, `sameSite: "lax"`, `secure` in production.
- [ ] `/login` has pending (default) and expired states; `/dashboard` redirects unauthenticated users to `/login`.
- [ ] `apps/worker/src/alerts/dispatch.ts` and `providers/email.ts` handle `org_id === null` / `email === null` without `any` or non-null assertions — covered by Task 3 tests.
