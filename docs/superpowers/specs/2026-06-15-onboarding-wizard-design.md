# Onboarding Wizard Design

**Date:** 2026-06-15
**Status:** Approved
**Scope:** `/onboarding` multi-step setup wizard for new users (first login)

---

## Overview

When a user logs in via Telegram for the first time, they have `email = null` and no subscription row. The middleware gates all authenticated routes: `!email → redirect /onboarding`. The current `/onboarding` is a single email-collection page. This spec extends it into a 5-step wizard (Step 0–4) that also captures module selection, tender alert categories, and Telegram alert chat ID.

Re-entry is intentionally allowed — authenticated users with email set can revisit `/onboarding` to update their module/category/telegram preferences before `/settings` is built.

---

## Architecture

### Approach chosen

Single `/onboarding` route with `?step=N` URL param. Step state lives in the URL so it survives page refresh. A server component fetches existing data and passes it to a client component that drives the wizard.

### Files changed

| File | Change |
|------|--------|
| `packages/db/src/schema/index.ts` | Add `categories text[]` column to `subscriptions` |
| `packages/db/migrations/0005_*.sql` | `ALTER TABLE subscriptions ADD COLUMN categories text[] NOT NULL DEFAULT '{}'` |
| `apps/platform/src/auth.ts` | After inserting new user row on first login, also insert a `subscriptions` row (empty defaults) |
| `apps/platform/src/app/onboarding/page.tsx` | Replace email-only page with server component; reads `searchParams.step`, fetches DB state, auto-advances past Step 0 if email already set, renders `<OnboardingWizard>` |
| `apps/platform/src/app/onboarding/actions.ts` | Extend with `saveModules`, `saveCategories`, `saveTelegramChatId`; modify `saveEmail` to redirect to `?step=1` |
| `apps/platform/src/app/onboarding/wizard.tsx` | New client component — owns step rendering and `?step=N` navigation |
| `apps/platform/src/lib/tender-categories.ts` | Hardcoded `TENDER_CATEGORIES` constant |

**No middleware changes.** `/onboarding` is already in `PUBLIC_PREFIXES`. The email gate (`!session.user.email → /onboarding`) remains the forcing function for new users.

### Data model change

```sql
-- migration 0005
ALTER TABLE "subscriptions"
  ADD COLUMN "categories" text[] NOT NULL DEFAULT '{}';
```

Subscription row is created in `auth.ts` at first user creation (empty defaults: `modules: [], categories: [], status: "trial"`). This guarantees a subscription row always exists for any user.

---

## Step-by-Step Flow

All steps live at `/onboarding?step=N`.

### Step 0 — Email
- **Shown when:** `session.user.email` is null
- **Auto-skipped:** if email already set, `effectiveStep = Math.max(requestedStep, 1)`
- **UI:** Email input + "Continue" button
- **Action:** `saveEmail` — validates, upserts `users.email`, calls `unstable_update` to refresh JWT, redirects to `?step=1`
- **Skip:** None — email is required by middleware. Skipping would loop the user back.

### Step 1 — Module
- **Shown at:** `?step=1`
- **UI:** Three cards — **Тендер**, **ГазарПрайс**, **Хоёулаа** (both). Pre-selected if subscription already has modules.
- **Action:** `saveModules` — upserts `subscriptions` (creates if missing) with selected modules array. On success, client pushes `?step=2`.
- **Skip:** Advances to `?step=2` without saving.

### Step 2 — Categories
- **Shown at:** `?step=2`, **only if** modules includes `"tender"`. Otherwise auto-advances to `?step=3`.
- **UI:** Checkbox list from `TENDER_CATEGORIES`. Pre-checked from `subscription.categories`.
- **Action:** `saveCategories` — updates `subscriptions.categories`. Empty `[]` = alert on all categories.
- **Skip:** Advances to `?step=3` without saving.

### Step 3 — Telegram
- **Shown at:** `?step=3`
- **UI:**
  - Deep link: `t.me/{BOT_USERNAME}?start=link` (env var `TELEGRAM_BOT_USERNAME`)
  - Instructions: "Add the bot or a group, then send `/start`. The bot will reply with your chat ID."
  - Input for chat ID (signed integer; negative numbers are group chats)
  - If `TELEGRAM_BOT_USERNAME` is unset: shows a placeholder with a warning banner
- **Action:** `saveTelegramChatId` — validates input is a valid integer, updates `users.telegram_chat_id`.
- **Skip:** Advances to `?step=4` without saving.

### Step 4 — Done
- **Shown at:** `?step=4`
- **UI:** "You're all set!" confirmation. Button → `router.push("/dashboard")`.
- **No action, no skip.**

---

## Component Structure

```
/onboarding/
  page.tsx          — server component: auth check, DB fetch, renders <OnboardingWizard>
  wizard.tsx        — client component: step router, progress bar, step UIs as internal fns
  actions.ts        — saveEmail, saveModules, saveCategories, saveTelegramChatId
/lib/
  tender-categories.ts  — TENDER_CATEGORIES constant (hardcoded list)
```

`OnboardingWizard` props:
```ts
{
  initialStep: number;          // computed by page.tsx (effectiveStep)
  existingEmail: string | null;
  existingModules: string[];
  existingCategories: string[];
  existingTelegramChatId: string | null;
}
```

Internally uses `useRouter` + `useSearchParams` to push `?step=N`. Uses `useTransition` wrapping server action calls for loading state.

---

## Error & Loading States

### Loading
- `useTransition` pending: disable Continue button, show "Saving…" label
- Skip button is **not** disabled during pending (it doesn't call any action)

### Errors (inline, below the relevant input)
| Step | Error cases |
|------|-------------|
| 0 (email) | "Please enter a valid email address" / "That email is already in use" |
| 1 (module) | None expected (always a valid selection) |
| 2 (categories) | None expected |
| 3 (telegram) | "Chat ID must be a number" / "Failed to save — please try again" |

### Edge states
- Categories with nothing checked: valid — `[]` means alert on all tender categories
- `TELEGRAM_BOT_USERNAME` env var unset: Telegram step shows warning note instead of deep link

---

## Tender Categories (hardcoded)

```ts
export const TENDER_CATEGORIES = [
  "Барилга угсралт",    // Construction
  "Бараа нийлүүлэлт",  // Goods supply
  "Үйлчилгээ",          // Services
  "Зөвлөх үйлчилгээ",  // Consulting
  "Технологи, МТ",      // Technology / IT
  "Тоног төхөөрөмж",   // Equipment
  "Хүнс, ундаа",        // Food & Beverage
  "Эм, эмнэлгийн хэрэгсэл", // Pharmaceuticals & Medical
  "Судалгаа, шинжилгээ", // Research
  "Сургалт",             // Training
] as const;
```

---

## Non-Goals / Out of Scope

- `/settings` page (future — onboarding acts as a temporary proxy until then)
- Email/SMS alert channel selection (belongs in subscription billing flow)
- Organization-level onboarding (currently one user = one org)
- QPay subscription step (separate billing flow)
