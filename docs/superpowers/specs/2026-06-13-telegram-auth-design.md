# Telegram Bot Deep-Link Auth — Design Spec

**Date:** 2026-06-13
**Status:** Approved

## Goal

Telegram-only login for `apps/platform` (starting with the GazarPrice route group). No
password, OTP, or email. A user clicks a "Telegram-ээр нэвтрэх" button, which deep-links to
`t.me/{BOT_USERNAME}?start=auth_{token}`; the bot's webhook claims the token and links the
user's Telegram identity; the browser polls until the token is claimed, then sets a signed
session cookie and redirects to `/dashboard`.

This **extends the existing `users` table** rather than introducing a parallel identity
table — `org_id` and `email` become nullable (Telegram-only signups have neither at first).
This supersedes the "Auth.js (B2B email/password + org accounts)" line in CLAUDE.md's stack
section for now; org/email become an optional B2B overlay added to a `users` row later. A
CLAUDE.md stack-note update is part of this change.

---

## File Layout

```
packages/db/src/schema/index.ts        ← extend users (telegram_id, telegram_username,
                                           first_name, last_login_at; org_id/email → nullable),
                                           NEW authTokens table
packages/db/migrations/0005_*.sql      ← generated via `pnpm db:generate`

packages/core/src/notifications/telegram.ts      ← extract sendTelegramMessageTo(chatId, text);
                                                     sendTelegramMessage delegates to it
packages/core/src/notifications/telegram.test.ts ← tests for sendTelegramMessageTo
packages/core/src/index.ts             ← export sendTelegramMessageTo

apps/worker/src/alerts/types.ts        ← Recipient.email becomes optional
apps/worker/src/alerts/dispatch.ts     ← skip if user.org_id is null; conditional email
                                           spread + email channel gate
apps/worker/src/alerts/providers/email.ts ← defensive check: recipient.email required
apps/worker/src/alerts/dispatch.test.ts   ← cases for null org_id / null email

apps/platform/package.json             ← add zod, drizzle-orm deps; add vitest + test script
apps/platform/vitest.config.ts         ← NEW (mirrors apps/worker)
apps/platform/src/env.ts               ← NEW: zod env schema
apps/platform/src/env.test.ts          ← NEW
apps/platform/src/lib/session.ts       ← NEW: HMAC sign/verify, getSession/setSession/clearSession
apps/platform/src/lib/session.test.ts  ← NEW
apps/platform/src/lib/auth-tokens.ts   ← NEW: createAuthToken(), TOKEN_TTL_MS
apps/platform/src/app/(gazar)/login/page.tsx         ← NEW
apps/platform/src/app/(gazar)/login/actions.ts       ← NEW: checkLoginStatus server action
apps/platform/src/app/(gazar)/login/login-poller.tsx ← NEW: client polling component
apps/platform/src/app/(gazar)/dashboard/page.tsx     ← NEW stub, session-gated
apps/platform/src/app/api/telegram/webhook/route.ts      ← NEW
apps/platform/src/app/api/telegram/webhook/route.test.ts ← NEW

.env.example                            ← add BOT_USERNAME, SESSION_SECRET
CLAUDE.md                                ← stack-note update (Auth section)
```

---

## 1. Schema changes (`packages/db/src/schema/index.ts`)

### `users` — add nullable columns, relax two existing ones

```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id),       // was .notNull()
    email: text("email"),                                           // was .notNull()
    name: text("name"),
    telegramId: bigint("telegram_id", { mode: "number" }),          // NEW
    telegramUsername: text("telegram_username"),                    // NEW
    firstName: text("first_name"),                                  // NEW
    telegramChatId: text("telegram_chat_id"),
    phone: text("phone"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }), // NEW
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_org_id_idx").on(t.orgId),
  ],
);
```

`bigint(..., { mode: "number" })` — Telegram user IDs fit comfortably within
`Number.MAX_SAFE_INTEGER`; using `number` mode avoids `bigint`-vs-`number` friction in
session payloads and JSON responses. Unique index on a nullable column is fine in Postgres
(multiple `NULL`s are allowed and don't collide).

### NEW `auth_tokens` table

```ts
export const authTokens = pgTable("auth_tokens", {
  token: text("token").primaryKey(),               // 32-char hex, crypto.randomBytes(16)
  telegramId: bigint("telegram_id", { mode: "number" }), // null until claimed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumed: boolean("consumed").notNull().default(false),
});
```

New imports needed in `schema/index.ts`: `bigint`, `boolean`.

### Migration

Run `pnpm db:generate` after the schema edit. Expected output (`0005_*.sql`):

```sql
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "telegram_id" bigint;
ALTER TABLE "users" ADD COLUMN "telegram_username" text;
ALTER TABLE "users" ADD COLUMN "first_name" text;
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;
CREATE UNIQUE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");

CREATE TABLE "auth_tokens" (
  "token" text PRIMARY KEY,
  "telegram_id" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed" boolean DEFAULT false NOT NULL
);
```

Safe on existing data — zero rows depend on `org_id`/`email` being non-null at the DB level
(only app code did), and the new columns/table are additive.

---

## 2. Ripple fix: `apps/worker/src/alerts` (nullable `users.org_id` / `users.email`)

`dispatch.ts` currently does `email: user.email` into a `Recipient` whose `email: string` is
required, and `eq(subscriptions.orgId, user.orgId)` where `subscriptions.orgId` is
non-nullable `uuid`. Both break once `users.org_id`/`users.email` become `string | null`.

**`types.ts`** — make `email` optional, matching `telegramChatId`/`phone`:

```ts
export interface Recipient {
  userId: string;
  email?: string;
  telegramChatId?: string;
  phone?: string;
}
```

**`dispatch.ts`** — add an early guard (also narrows `user.orgId` to `string` for the
subsequent `eq(subscriptions.orgId, user.orgId)` call):

```ts
if (!user.orgId) {
  logger.warn({ userId: payload.userId }, "dispatchAlert: user has no org — skipping");
  return;
}
```

Conditional spread for `email` (mirrors the existing `telegramChatId`/`phone` pattern):

```ts
const recipient: Recipient = {
  userId: user.id,
  ...(user.email          != null && { email:          user.email }),
  ...(user.telegramChatId != null && { telegramChatId: user.telegramChatId }),
  ...(user.phone          != null && { phone:          user.phone }),
};
```

Add an `email` channel gate next to the existing `telegram` gate:

```ts
if (channel === "email" && !recipient.email) {
  logger.info({ userId: user.id }, "dispatchAlert: email not set — skipping email");
  continue;
}
```

**`providers/email.ts`** — defensive boundary check (keeps `Resend.emails.send({ to: ... })`
typed as `string`, not `string | undefined`):

```ts
async send(notification: Notification, recipient: Recipient): Promise<void> {
  if (!recipient.email) {
    throw new Error("ResendEmailProvider: recipient.email is required");
  }
  // ...to: recipient.email unchanged
}
```

---

## 3. `packages/core/src/notifications/telegram.ts` — `sendTelegramMessageTo`

Extract the fetch call so the webhook can reply to an arbitrary chat (not just the fixed ops
`TELEGRAM_CHAT_ID`):

```ts
export async function sendTelegramMessageTo(chatId: string | number, text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN must be set");

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID must be set");
  return sendTelegramMessageTo(chatId, text);
}
```

Export `sendTelegramMessageTo` from `packages/core/src/index.ts`.

---

## 4. `apps/platform/src/env.ts`

Mirrors `apps/worker/src/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1), // required by @mn-platform/db client.ts at import time
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  BOT_USERNAME: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
```

`BOT_USERNAME` is the bare bot username **without** a leading `@` (e.g. `GazarPriceBot`) —
`t.me/{BOT_USERNAME}?start=...` is built directly from this value.

---

## 5. `apps/platform/src/lib/session.ts`

HMAC-SHA256 signed cookie via `node:crypto` — no new dependency (jose/next-auth not
verified/installed).

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "../env.js";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string): string {
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

`session.test.ts` covers `createSessionToken`/`verifySessionToken` directly (pure
sign/verify — no `next/headers` needed for those two).

---

## 6. `apps/platform/src/lib/auth-tokens.ts`

```ts
import { randomBytes } from "node:crypto";

export const AUTH_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateAuthToken(): string {
  return randomBytes(16).toString("hex"); // 32 hex chars
}
```

---

## 7. Login flow

### `app/(gazar)/login/page.tsx` (server component)

- Inserts a new `auth_tokens` row (`token`, `expiresAt = now + 5min`, `consumed = false`).
- Renders the deep-link button: `https://t.me/${env.BOT_USERNAME}?start=auth_${token}`.
- Renders `<LoginPoller token={token} />`.
- If `getSession()` already has a valid session, redirect straight to `/dashboard` (don't
  generate a token).

### `app/(gazar)/login/actions.ts` — `"use server"`

```ts
export type LoginStatus = "pending" | "expired";

export async function checkLoginStatus(token: string): Promise<LoginStatus> {
  const tokenRow = await db.query.authTokens.findFirst({ where: eq(authTokens.token, token) });

  if (!tokenRow || tokenRow.expiresAt < new Date()) return "expired";
  if (!tokenRow.consumed || tokenRow.telegramId == null) return "pending";

  const user = await db.query.users.findFirst({ where: eq(users.telegramId, tokenRow.telegramId) });
  if (!user) return "expired"; // shouldn't happen — webhook upserts before marking consumed

  await setSession(user.id);
  redirect("/dashboard");
}
```

`redirect()` thrown from a Server Action works for client-invoked actions (not just form
actions) in Next.js 15 — the action runtime performs the client-side navigation.

### `app/(gazar)/login/login-poller.tsx` — `"use client"`

- `useEffect` + `setInterval(2000)` calling `checkLoginStatus(token)`.
- `"pending"` → keep polling.
- `"expired"` → clear interval, show "Холбоосын хугацаа дууссан. Хуудсыг шинэчлээд дахин
  оролдоно уу." (the new design surface's error state).
- On success the action itself redirects — no client-side branch needed for "done".

### `app/(gazar)/dashboard/page.tsx` (stub)

```ts
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  return <main>Тавтай морил, {user?.firstName ?? user?.telegramUsername ?? "хэрэглэгч"}!</main>;
}
```

Exists only so the post-login redirect target isn't a 404. Full dashboard is future work.

---

## 8. `app/api/telegram/webhook/route.ts`

```ts
const TelegramUpdateSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    chat: z.object({ id: z.number() }),
    from: z.object({
      id: z.number(),
      username: z.string().optional(),
      first_name: z.string().optional(),
    }),
  }).optional(),
});

const AUTH_START_RE = /^\/start auth_([a-f0-9]{32})$/;

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
        // Sprint B: signup-without-token flow. Generic placeholder for now.
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

async function handleAuthStart(
  token: string,
  from: { id: number; username?: string; first_name?: string },
  chatId: number,
): Promise<void> {
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

Error handling: any thrown error is caught and logged; the route still returns `200` so
Telegram doesn't enter a retry loop on a malformed/unexpected update.

---

## 9. Env additions

`.env.example`:

```
BOT_USERNAME=
SESSION_SECRET=
```

(`TELEGRAM_BOT_TOKEN` already present — shared by worker ops feed and platform webhook,
same bot.)

`apps/platform/package.json` — add `zod` (`^4.4.3`, matches other packages) and
`drizzle-orm` (`^0.41.0`, for `eq`) as direct dependencies; add `vitest` devDep + `test`
script + `vitest.config.ts` (mirrors `apps/worker`).

**One-time webhook registration** (documented as a comment near the route, not automated):

```
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${PUBLIC_URL}/api/telegram/webhook"
```

For local dev, `PUBLIC_URL` must be a tunnel (ngrok/cloudflared) — Telegram requires a public
HTTPS endpoint.

---

## 10. CLAUDE.md update

Update the **Auth** stack line to note Telegram bot deep-link is the primary login for
`apps/platform` (superseding "Auth.js B2B email/password" for now); org/email remain on
`users` as an optional B2B overlay for TenderAlert, added when a user joins an org.

---

## Tests

- `session.test.ts`: sign → verify round trip returns the same `userId`; tampered token
  (flipped signature byte) returns `null`; expired token (negative TTL) returns `null`.
- `telegram.test.ts`: `sendTelegramMessageTo` posts to the given `chatId` (not the ops
  `TELEGRAM_CHAT_ID`); `sendTelegramMessage` still targets `TELEGRAM_CHAT_ID` (regression).
- `env.test.ts`: missing `SESSION_SECRET`/`BOT_USERNAME` throws.
- `webhook/route.test.ts` (db mocked):
  - valid `/start auth_<token>` → user upserted, token marked consumed +
    `telegramId` set, confirmation reply sent.
  - expired/consumed/unknown token → "expired" reply, no user mutation.
  - existing `telegram_id` → update path (no duplicate row), `lastLoginAt` bumped.
  - bare `/start` (no token) → generic placeholder reply, no DB writes.
  - malformed JSON body → caught, still returns `200`.
- `dispatch.test.ts` additions:
  - `user.orgId === null` → `dispatchAlert` returns early, no provider called.
  - `user.email === null`, channel `"email"` → skipped (gate), other channels unaffected.

---

## Definition of Done

- [ ] `pnpm typecheck` passes — no `any` (covers the `Recipient.email` ripple).
- [ ] `pnpm lint` passes.
- [ ] Migration `0005_*` applies cleanly on top of `0004`.
- [ ] Re-running `/start auth_<token>` for an already-consumed token does not create a
      duplicate user or duplicate-claim the token (idempotent).
- [ ] Telegram webhook payload validated with `TelegramUpdateSchema` before any DB write.
- [ ] No secrets logged; `SESSION_SECRET` only read via `env.ts`.
- [ ] Session cookie is `httpOnly`, `sameSite: lax`, `secure` in production.
- [ ] Login page has pending + expired states (Definition of Done #5 — new UI surface).
- [ ] `dispatch.ts`/`providers/email.ts` handle `users.org_id`/`users.email` being `null`
      without `any` or non-null assertions.

---

## Out of scope (Sprint B / future)

- Signup flow for `/start` without an `auth_` token (placeholder reply only, for now).
- Phone capture via Telegram's contact-share feature (`users.phone` stays unpopulated by
  this flow).
- Org creation/joining for Telegram-only users (no UI yet — `org_id` stays `null`).
- Telegram webhook `secret_token` header validation (`setWebhook` supports it; not wired up
  here — flagged as a hardening follow-up).
