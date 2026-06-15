# Telegram Login Widget Auth Flow — Design Spec

**Date:** 2026-06-15
**Branch:** feat/gazarprice-unegui-adapter
**Status:** Approved

---

## Overview

Add Telegram Login Widget authentication to `apps/platform` using Auth.js v5 (next-auth@beta) with a Credentials provider. Users log in via Telegram on a dedicated `/login` page, are upserted into the DB, and must provide an email on first login before accessing `/dashboard`. Admin routes are gated by `ADMIN_TELEGRAM_IDS` env var.

---

## 1. Database Changes (migration 0004)

Four changes to the `users` table:

| Change | Detail |
|---|---|
| `email` → nullable | Telegram doesn't provide email; collected post-login via `/onboarding` |
| Add `telegram_id bigint UNIQUE NOT NULL` | Login identity from widget. Upsert key. |
| Add `telegram_username text` | Telegram @username for display |
| Add `last_login_at timestamptz` | Track login recency |

`telegram_chat_id` (already present) remains the alert-delivery field — separate concern from login identity.

Drizzle schema (`packages/db/src/schema/index.ts`) updated to match. Migration is idempotent via Drizzle's standard `db:generate` + `db:migrate` flow.

---

## 2. HMAC Verification

**File:** `apps/platform/src/lib/telegram-auth.ts`

Implements Telegram's required verification algorithm:

1. Collect all widget fields except `hash`, sort alphabetically, join as `key=value\n` (no trailing newline) → `data_check_string`
2. Compute `secret_key = SHA-256(BOT_TOKEN)` (raw bytes, not hex)
3. Compute `sig = HMAC-SHA-256(secret_key, data_check_string)` → hex string
4. Compare `sig` to `hash` using `crypto.timingSafeEqual` (prevents timing attacks)
5. Reject if `auth_date` is older than 86400 seconds (24 hours)
6. On success, return typed `TelegramUser`; on failure, throw

**Exports:**
```ts
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

function verifyTelegramPayload(payload: unknown, botToken: string): TelegramUser
```

---

## 3. Auth.js v5 Configuration

**File:** `apps/platform/src/auth.ts`

```ts
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  providers: [
    Credentials({
      authorize(credentials) {
        // 1. verifyTelegramPayload(credentials, BOT_TOKEN)  — throws on failure
        // 2. Find existing user by telegram_id
        //    • If NOT found: INSERT org → INSERT user (with new org_id)
        //    • If found:     UPDATE name/telegram_username/last_login_at only
        // 3. Return { id, telegramId, name, email, orgId }
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      // embed telegramId, email, orgId on first sign-in
    },
    session({ session, token }) {
      // forward telegramId, email, orgId to session.user
    }
  },
  pages: {
    signIn: "/login",
    error: "/login",
  }
})
```

JWT session strategy (default for Credentials in Auth.js v5). Session cookie is httpOnly, signed with `AUTH_SECRET`.

---

## 4. Routes

| Path | File | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | `app/api/auth/[...nextauth]/route.ts` | Auth.js handlers (GET + POST) |
| `/login` | `app/login/page.tsx` | Telegram widget; JS callback mode |
| `/onboarding` | `app/onboarding/page.tsx` | Email collection form for new users |
| `/api/auth/complete-email` | `app/api/auth/complete-email/route.ts` | POST — saves email, redirects to `/dashboard` |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Protected stub |
| `/admin` | `app/admin/page.tsx` | Admin-gated stub |

### Login page behaviour

Telegram widget configured with `data-onauth="onTelegramAuth(user)"` (JS callback mode). On callback:

```ts
async function onTelegramAuth(user: TelegramUser) {
  const result = await signIn("credentials", { ...user, redirect: false });
  if (result?.error) { showError(); return; }
  router.push(session.user.email ? "/dashboard" : "/onboarding");
}
```

### Onboarding page behaviour

Simple form: one email input + submit. POST to `/api/auth/complete-email`. On success, the route:
1. Updates `users.email` in DB
2. Calls `unstable_update({ user: { email } })` (exported from `auth.ts`) to refresh the JWT cookie in-place — without this step the middleware would still see `email: null` and loop back to `/onboarding`
3. Returns a redirect to `/dashboard`

If email is already taken by another user, returns 409 and form shows an inline error.

---

## 5. Middleware

**File:** `apps/platform/src/middleware.ts`

```
Matcher: all routes except _next/static, _next/image, favicon
```

| Route | Rule |
|---|---|
| `/login`, `/onboarding`, `/api/auth/*` | Always public — no session check |
| `/admin/*` | Session required AND `session.user.telegramId` in `ADMIN_TELEGRAM_IDS` (comma-split). Returns 403 on fail — not a redirect. |
| All other routes | Session required. If `session.user.email` is null → redirect `/onboarding`. If no session → redirect `/login`. |

Middleware reads session via `auth()` from Auth.js v5. No DB query at middleware time — all needed fields (`telegramId`, `email`) are embedded in the JWT.

---

## 6. Environment Variables

| Variable | Visibility | Purpose |
|---|---|---|
| `AUTH_SECRET` | Secret | Auth.js session signing key (generate with `openssl rand -base64 32`) |
| `TELEGRAM_BOT_TOKEN` | Secret | HMAC verification key — never exposed to client |
| `TELEGRAM_BOT_NAME` | Public (`NEXT_PUBLIC_`) | Widget `data-telegram-login` attribute |
| `ADMIN_TELEGRAM_IDS` | Secret | Comma-separated Telegram user IDs with admin access |

---

## 7. Error Handling

| Scenario | Behaviour |
|---|---|
| HMAC mismatch or stale `auth_date` | `authorize()` throws → Auth.js returns null → `/login?error=Verification` |
| DB upsert fails | Same error path |
| `/login` visited while authenticated | Middleware redirects to `/dashboard` |
| `/dashboard` with no session | Redirect to `/login` |
| `/dashboard` with session but no email | Redirect to `/onboarding` |
| `/admin` with session but not in admin list | 403 response (no redirect — avoids leaking route existence) |
| Email conflict on `/api/auth/complete-email` | 409 + inline form error |

---

## 8. Tests

**File:** `apps/platform/src/lib/telegram-auth.test.ts`

- Valid payload with correct hash → returns `TelegramUser`
- Tampered `hash` field → throws
- `auth_date` > 86400s ago → throws
- Missing required fields → throws

Full login → session → dashboard → logout cycle: manual checklist (no Playwright infra yet).

---

## Out of Scope

- Email/password auth (future Auth.js provider)
- SMS/OTP login
- Org invitations / multi-user orgs
- Session revocation (logout is client-side cookie clear only)
