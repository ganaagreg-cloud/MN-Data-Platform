# Telegram Login Widget + Auth.js — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Goal

Replace the Telegram bot deep-link login (auth_tokens table, `/login` poller, webhook-based
auth, custom HMAC session cookie) with the **Telegram Login Widget** + **Auth.js v5**
(`next-auth@5.0.0-beta.31`), using a custom Credentials provider that verifies the widget's
signed payload server-side. One auth path only.

On login: upsert the `users` row (`telegram_id`, `telegram_username`, `first_name`,
`last_login_at`), and if the user has no `org_id` yet, auto-create a personal organization
and link it. `/admin/*` routes are gated by `ADMIN_TELEGRAM_IDS` (env var, comma-separated
numeric Telegram IDs), checked dynamically on every request via the JWT callback.

## Relationship to previous design

This **supersedes** `docs/superpowers/specs/2026-06-13-telegram-auth-design.md` in full.
That design's `auth_tokens` table, `/login` poller, webhook route, and `lib/session.ts`
HMAC cookie are all removed. The `users` table columns it added
(`telegram_id`/`telegram_username`/`first_name`/`last_login_at`, plus nullable
`org_id`/`email`) are **kept** — only how they're populated changes. The "B2B overlay /
`org_id` stays null" framing from that design is reversed: `org_id` is now populated
automatically via a personal org on first login. `email` remains nullable/unused pending
the B2B overlay.

---

## Decisions

**Session strategy — JWT, no Auth.js DB adapter.** `session: { strategy: "jwt" }` with a
Credentials provider needs zero Auth.js-owned tables (`accounts`/`sessions`/
`verification_tokens`). The existing `users` table is the only thing Auth.js touches, via
`authorize()`'s own DB calls. A `@auth/drizzle-adapter` + database-session approach would
add Auth.js-shaped tables that don't map onto a non-OAuth Credentials flow.

**Widget integration — JS callback (`data-onauth`) + client-side `signIn("credentials", …)`.**
The widget's `onTelegramAuth(user)` JS callback fires in-browser with the signed payload; a
client component forwards it into `signIn("credentials", payload)` →
`/api/auth/callback/credentials` → `authorize()` does the HMAC check server-side. One round
trip. The alternative (`data-auth-url` redirect mode) needs an extra hop to re-enter the
Credentials POST flow, for no benefit.

**Admin gate — pure env check, recomputed every request.** `ADMIN_TELEGRAM_IDS` is parsed
once in `env.ts` into a `Set<number>`. The `jwt` callback recomputes `token.isAdmin` from
`token.telegramId` on every call (cheap, no DB) — changing the env var takes effect without
forcing re-login. A persisted `users.is_admin` column would need its own migration and a
toggle UI, contradicting "gate via env var."

---

## File Layout

```
packages/db/src/schema/index.ts        ← remove authTokens table + unused `boolean` import,
                                           update users comment (org_id no longer "stays null")
packages/db/migrations/0006_drop_auth_tokens.sql ← NEW: DROP TABLE auth_tokens

apps/platform/package.json             ← add next-auth@5.0.0-beta.31
apps/platform/src/env.ts               ← remove SESSION_SECRET; add AUTH_SECRET,
                                           ADMIN_TELEGRAM_IDS + isAdminTelegramId()
apps/platform/src/auth.ts              ← NEW: NextAuth() config
apps/platform/src/types/next-auth.d.ts ← NEW: module augmentation
apps/platform/src/app/api/auth/[...nextauth]/route.ts ← NEW

apps/platform/src/lib/telegram-auth-schema.ts      ← NEW: Zod schema + verifyTelegramAuth
apps/platform/src/lib/telegram-auth-schema.test.ts ← NEW
apps/platform/src/lib/upsert-telegram-user.ts      ← NEW: upsert + personal-org creation
apps/platform/src/lib/upsert-telegram-user.test.ts ← NEW

apps/platform/src/app/(gazar)/login/page.tsx               ← REWRITE
apps/platform/src/app/(gazar)/login/telegram-login-button.tsx ← NEW (client)
apps/platform/src/app/(gazar)/dashboard/page.tsx            ← REWRITE

apps/platform/src/app/admin/layout.tsx ← NEW: isAdmin gate
apps/platform/src/app/admin/page.tsx   ← NEW: stub

.env.example                            ← replace SESSION_SECRET with AUTH_SECRET,
                                           add ADMIN_TELEGRAM_IDS
CLAUDE.md                                ← Auth stack line + "Auth flow (built so far)"
                                           Progress entry rewritten

REMOVED:
apps/platform/src/lib/auth-tokens.ts (+ .test.ts)
apps/platform/src/lib/session.ts (+ .test.ts)
apps/platform/src/app/api/telegram/webhook/route.ts (+ .test.ts)
apps/platform/src/app/(gazar)/login/actions.ts
apps/platform/src/app/(gazar)/login/login-poller.tsx
```

---

## 1. Schema & migration (`packages/db/src/schema/index.ts`)

Remove the `authTokens` table (current lines 169–179) and drop `boolean` from the
`drizzle-orm/pg-core` import list (it's only used by `authTokens.consumed`).

Update the `users` table comment (current lines 28–31):

```ts
// ── users ─────────────────────────────────────────────────────────────────────
// org_id is populated automatically: a personal organization is created on first
// login (see upsertTelegramUser). email stays nullable/unused until the optional
// B2B overlay. telegram_id is the identity for the Telegram Login Widget flow.
```

No column changes — `telegram_id`/`telegram_username`/`first_name`/`last_login_at`/`org_id`
and the unique index `users_telegram_id_idx` already exist from migration 0005.

### New migration `0006_drop_auth_tokens.sql`

```sql
DROP TABLE "auth_tokens";
```

---

## 2. `apps/platform/src/lib/telegram-auth-schema.ts`

```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const TelegramAuthPayloadSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().min(1),
});

export type TelegramAuthPayload = z.infer<typeof TelegramAuthPayloadSchema>;

/**
 * Verifies the Telegram Login Widget's HMAC-SHA256 signature.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(
  raw: Record<string, string | undefined>,
  botToken: string,
): boolean {
  const { hash, ...rest } = raw;
  if (!hash) return false;

  const checkString = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(checkString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
```

`verifyTelegramAuth` runs on the raw string credentials (as `signIn` posts them) — before Zod
coercion — since the signature was computed over Telegram's literal string representation.
`authorize()` calls this first, then `TelegramAuthPayloadSchema.parse()` for typed access,
then checks `auth_date` against `MAX_AUTH_AGE_SECONDS` to reject replayed old payloads.

---

## 3. `apps/platform/src/lib/upsert-telegram-user.ts`

```ts
import { eq } from "drizzle-orm";
import { db, organizations, users } from "@mn-platform/db";
import type { TelegramAuthPayload } from "./telegram-auth-schema.js";

export async function upsertTelegramUser(payload: TelegramAuthPayload) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        telegramId: payload.id,
        telegramUsername: payload.username ?? null,
        firstName: payload.first_name,
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          telegramUsername: payload.username ?? null,
          firstName: payload.first_name,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    if (!user) throw new Error("upsertTelegramUser: upsert returned no row");
    if (user.orgId) return user;

    const [org] = await tx
      .insert(organizations)
      .values({ name: `${payload.first_name}'s workspace` })
      .returning();
    if (!org) throw new Error("upsertTelegramUser: org insert returned no row");

    const [updated] = await tx
      .update(users)
      .set({ orgId: org.id })
      .where(eq(users.id, user.id))
      .returning();
    if (!updated) throw new Error("upsertTelegramUser: org-link update returned no row");

    return updated;
  });
}
```

`onConflictDoUpdate` on `users_telegram_id_idx` (unique) makes the upsert atomic — closes the
TOCTOU race flagged against the old webhook's read-then-write upsert. Wrapping the
org-creation in the same transaction means a user never ends up with `org_id: null` after a
successful login, and concurrent first-logins for the same `telegram_id` serialize on the
unique index rather than creating two personal orgs.

---

## 4. `apps/platform/src/env.ts`

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Bare bot username, WITHOUT a leading "@" — used for the Login Widget's data-telegram-login attr.
  BOT_USERNAME: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  // Comma-separated Telegram numeric user IDs. Empty string = no admins.
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

const adminTelegramIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
);

export function isAdminTelegramId(telegramId: number | null | undefined): boolean {
  return telegramId != null && adminTelegramIds.has(telegramId);
}
```

`SESSION_SECRET` is removed (the custom cookie it signed is gone). `AUTH_SECRET` is Auth.js's
standard secret for signing JWTs.

---

## 5. `apps/platform/src/auth.ts`

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env, isAdminTelegramId } from "./env.js";
import {
  MAX_AUTH_AGE_SECONDS,
  TelegramAuthPayloadSchema,
  verifyTelegramAuth,
} from "./lib/telegram-auth-schema.js";
import { upsertTelegramUser } from "./lib/upsert-telegram-user.js";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  secret: env.AUTH_SECRET,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Telegram",
      credentials: {
        id: {}, first_name: {}, last_name: {}, username: {}, photo_url: {}, auth_date: {}, hash: {},
      },
      authorize: async (raw) => {
        const credentials = raw as Record<string, string | undefined>;
        if (!verifyTelegramAuth(credentials, env.TELEGRAM_BOT_TOKEN)) return null;

        const payload = TelegramAuthPayloadSchema.parse(credentials);
        if (Date.now() / 1000 - payload.auth_date > MAX_AUTH_AGE_SECONDS) return null;

        const user = await upsertTelegramUser(payload);
        return {
          id: user.id,
          name: user.firstName ?? user.telegramUsername ?? null,
          telegramId: user.telegramId,
          orgId: user.orgId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.telegramId = user.telegramId;
        token.orgId = user.orgId;
      }
      token.isAdmin = isAdminTelegramId(token.telegramId);
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId;
      session.user.telegramId = token.telegramId;
      session.user.orgId = token.orgId;
      session.user.isAdmin = token.isAdmin;
      return session;
    },
  },
});
```

`TelegramAuthPayloadSchema.parse()` satisfies Definition of Done #4 — the widget payload is
external input and is Zod-validated (after HMAC verification) before `upsertTelegramUser`
touches the DB.

### `apps/platform/src/types/next-auth.d.ts`

```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      telegramId: number;
      orgId: string;
      isAdmin: boolean;
    };
  }

  interface User {
    telegramId: number;
    orgId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    telegramId: number;
    orgId: string;
    isAdmin: boolean;
  }
}
```

### `apps/platform/src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

---

## 6. Login page & widget

### `apps/platform/src/app/(gazar)/login/telegram-login-button.tsx` (client)

```tsx
"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

export function TelegramLoginButton({ botUsername }: { botUsername: string }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    window.onTelegramAuth = (user) => {
      const credentials = Object.fromEntries(
        Object.entries(user).map(([k, v]) => [k, String(v)]),
      );
      void signIn("credentials", { ...credentials, redirect: false }).then((res) => {
        if (res?.ok) {
          window.location.href = "/dashboard";
        } else {
          setError(true);
        }
      });
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    document.getElementById("telegram-login-container")?.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername]);

  return (
    <div>
      <div id="telegram-login-container" />
      {error && <p>Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.</p>}
    </div>
  );
}
```

### `apps/platform/src/app/(gazar)/login/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/env";
import { TelegramLoginButton } from "./telegram-login-button";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <main>
      <h1>Нэвтрэх</h1>
      <p>Telegram ашиглан нэвтэрнэ үү.</p>
      <TelegramLoginButton botUsername={env.BOT_USERNAME} />
    </main>
  );
}
```

### `apps/platform/src/app/(gazar)/dashboard/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main>
      <h1>Тавтай морил, {session.user.name ?? "хэрэглэгч"}!</h1>
    </main>
  );
}
```

---

## 7. Admin gate

### `apps/platform/src/app/admin/layout.tsx`

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user.isAdmin) redirect("/login");
  return <>{children}</>;
}
```

### `apps/platform/src/app/admin/page.tsx`

```tsx
export default function AdminPage() {
  return (
    <main>
      <h1>Admin</h1>
    </main>
  );
}
```

Per CLAUDE.md, internal/admin-only tooling lives at the app root (`app/admin/`), not under a
`(tender)`/`(gazar)` route group.

---

## 8. Env additions

`.env.example` — replace:

```
SESSION_SECRET=
```

with:

```
AUTH_SECRET=
ADMIN_TELEGRAM_IDS=
```

`apps/platform/package.json` — add `"next-auth": "5.0.0-beta.31"` (exact pin, beta release).

---

## 9. Removals

- `apps/platform/src/lib/auth-tokens.ts` + `.test.ts`
- `apps/platform/src/lib/session.ts` + `.test.ts`
- `apps/platform/src/app/api/telegram/webhook/route.ts` + `.test.ts`
- `apps/platform/src/app/(gazar)/login/actions.ts`
- `apps/platform/src/app/(gazar)/login/login-poller.tsx`
- `authTokens` table from `packages/db/src/schema/index.ts` (dropped via migration 0006)

---

## Tests

- `telegram-auth-schema.test.ts`:
  - valid payload + correctly-computed hash (using a known test bot token fixture) →
    `verifyTelegramAuth` returns `true`.
  - any single field tampered → returns `false`.
  - missing/mismatched-length `hash` → returns `false` (no `timingSafeEqual` throw).
  - `auth_date` older than `MAX_AUTH_AGE_SECONDS` → rejected by the caller (covered via the
    constant + a date-math unit test, not inside `verifyTelegramAuth` itself).
  - `TelegramAuthPayloadSchema` rejects missing `id`/`hash`/`auth_date`; accepts payload
    without optional `last_name`/`username`/`photo_url`.
- `upsert-telegram-user.test.ts` (real Postgres, matches existing DB-adapter test pattern):
  - new `telegram_id` → creates `users` row + a new `organizations` row, `org_id` set.
  - repeat login (same `telegram_id`) → updates `telegram_username`/`first_name`/
    `last_login_at`, does **not** create a second org.
  - pre-existing user with `org_id` already set → org untouched, only profile fields update.

End-to-end widget → session flow requires a real bot (`BOT_USERNAME`/`TELEGRAM_BOT_TOKEN`)
and stays a manual verification step post-implementation, as with the previous deep-link
flow.

---

## Definition of Done

- [ ] `pnpm typecheck` passes — no `any` (module augmentation covers `session.user.*`/
      `token.*` typing).
- [ ] `pnpm lint` passes.
- [ ] Re-running login for the same `telegram_id` is idempotent: no duplicate `users` row,
      no duplicate personal `organizations` row.
- [ ] Telegram widget payload is HMAC-verified, then Zod-validated, before any DB write.
- [ ] `auth_date` freshness check rejects stale/replayed payloads.
- [ ] No secrets in code — `AUTH_SECRET`/`TELEGRAM_BOT_TOKEN`/`ADMIN_TELEGRAM_IDS` only via
      `env.ts`.
- [ ] Login page has a visible error state when `signIn` fails (Definition of Done #5).
- [ ] `/admin/*` redirects non-admins to `/login`.
- [ ] Migration `0006_drop_auth_tokens.sql` applies cleanly on top of `0005`.

---

## Out of scope

- No `subscriptions` row is created for the new personal org — that's the QPay billing
  flow's responsibility.
- `users.telegram_chat_id` (used by the worker's ops-notification feed,
  `packages/core/src/notifications/telegram.ts`) is untouched.
- No backfill migration for pre-existing org-less users — `upsertTelegramUser` handles them
  identically on their next login.
- `users.email`/`users.name` remain nullable and unpopulated by this flow (deferred B2B
  overlay, per the original telegram-auth design).
