# Design: Alert Fan-out + Tender Dashboard

**Date:** 2026-06-18
**Scope:** Two features in one plan — (1) wire real user alerts via Telegram when tenders are new/updated, and (2) build the `/dashboard` page showing matching tenders per user.

---

## Feature 1 — Alert Fan-out

### Problem

`dispatchAlert` already handles per-user delivery and idempotency, but nothing queries "which users match this tender" and enqueues the per-user jobs. `TelegramProvider` is a stub. The scrape pipeline's `onChanged` hook fires on every created/updated tender but has no way to trigger alerts.

### Design

#### `queryMatchingUsers(category: string | null): Promise<{ userId: string }[]>`

New function in `apps/worker/src/alerts/query-matching-users.ts`.

```sql
SELECT u.id
FROM users u
JOIN subscriptions s ON s.org_id = u.org_id
WHERE s.status = 'active'
  AND 'tender' = ANY(s.modules)
  AND cardinality(s.categories) > 0
  AND $category = ANY(s.categories)
```

Rules:
- If `category` is `null` → return `[]` immediately (no query). A tender with no category can't match any subscription filter.
- `cardinality(s.categories) = 0` → **skip** (no alert until user picks categories). This matches the dashboard empty-state behavior — silent until the user acts.
- Returns raw `{ userId }` rows; channel resolution is left entirely to `dispatch.ts`.

#### `TelegramProvider` implementation

`apps/worker/src/alerts/providers/telegram.ts` — implement `send()` using `sendTelegramMessage` from `@mn-platform/core/notifications/telegram`. The chat ID comes from `recipient.telegramChatId`. Message text = `notification.body` (already formatted in Mongolian by `formatTenderNotification`). Throws on API error so pg-boss retries.

#### Scrape job fan-out (`makeScrapeHandler`)

`apps/worker/src/jobs/scrape-tender-gov-mn.ts` gains a `boss: PgBoss` parameter. The `onChanged` hook:

1. Calls `queryMatchingUsers(tender.category)`.
2. For each result, calls `boss.send("alert-dispatch", { recordId: tender.id (from DB), contentHash, userId })`.
3. Wrapped in try/catch — errors are logged and swallowed; a Telegram outage or zero matching users must never fail the scrape job.

**Note:** `recordId` in the alert payload must be the DB row's UUID (from the upsert return), not the `externalId`. The `UpsertFn` signature currently returns `UpsertOutcome` (string enum). We need to extend it to also return the DB `id`. See migration section below.

#### `makeAlertDispatchHandler`

`apps/worker/src/jobs/alert-dispatch.ts` — register `[telegramProvider, emailProvider]`. No changes to provider list logic beyond adding `telegramProvider`. `dispatch.ts`'s existing `alertChannels` iteration and per-channel gates (`email` requires `recipient.email`, `telegram` requires `recipient.telegramChatId`) continue to handle all channel resolution — no duplication here.

#### `saveModules` default `alertChannels`

`apps/platform/src/app/onboarding/actions.ts` — set `alertChannels: ["telegram", "email"]` when inserting a new subscription (currently `[]`). Existing subscriptions with empty `alertChannels` will not get alerts until updated; acceptable for MVP (no backfill migration needed).

#### Idempotency

Unchanged: `insertNotificationSent` on `(recordId, contentHash, userId, channel)` after each successful send. pg-boss retries a failed job; since the send is attempted before the idempotency record is written, a partial failure is safe to retry.

#### `UpsertFn` return type change

To pass the DB UUID to `boss.send`, change `UpsertFn<TRecord>` return from `UpsertOutcome` to `{ outcome: UpsertOutcome; id: string }`. Update callers: `db-adapter.ts` (upsertTender, upsertListing), `pipeline.ts`, scrape jobs. Tests need updating.

`onChanged` gains a 4th parameter `dbId: string` (the UUID returned by `UpsertFn`). The pipeline passes it after the upsert: `await onChanged?.(validated, outcome, previous, id)`. The scrape job's `onChanged` uses `dbId` as `recordId` in the alert payload — this is the `tenders.id` PK, not the `externalId`.

---

## Feature 2 — Tender Dashboard

### Route

`apps/platform/src/app/(dashboard)/dashboard/page.tsx` — Next.js 15 RSC. Reads `searchParams`:

| Param | Type | Default |
|---|---|---|
| `status` | `"open" \| "closed" \| undefined` | all |
| `aimag` | `string \| undefined` | all |
| `cursor` | base64 string | start |

### Empty state (no categories set)

When `subscription.categories.length === 0`, render an inline `<CategoryPicker>` client component (checkboxes, `TENDER_CATEGORIES`) with a server action `saveDashboardCategories` that calls `saveCategories` logic then `revalidatePath("/dashboard")`. No redirect. On save, the page re-renders showing real tenders.

### Tender query

```ts
db.select().from(tenders)
  .where(and(
    inArray(tenders.category, userCategories),  // category filter
    statusFilter,   // optional: eq(tenders.status, "open"|"closed")
    aimagFilter,    // optional: eq(tenders.aimag, aimag)
    cursorFilter,   // keyset: deadline > cur OR (deadline = cur AND id > curId)
  ))
  .orderBy(asc(tenders.submissionDeadline), asc(tenders.id))  // NULLS LAST via Drizzle
  .limit(21)  // 21 to detect next page
```

Fetch 21 rows: if 21 returned, there is a next page (show Next link with cursor = row 20's `{deadline, id}` base64-encoded). Render only 20.

### Columns

| Column | Source | Format |
|---|---|---|
| Дугаар | `tender_no` | raw text, "—" if null |
| Байгууллага | `procuring_entity` | raw text |
| Төсөв | `est_budget_mnt` | `formatMnt()` from `@mn-platform/mn` |
| Дедлайн | `submission_deadline` | `toLocaleDateString("mn-MN", {timeZone:"Asia/Ulaanbaatar"})` |
| Төлөв | `status` | colored badge: open=green, closed=grey, announced=blue, awarded=teal, cancelled=red |

### Filter bar

`<form>` (GET, no JS required). Two `<select>` elements: status (Нээлттэй / Хаагдсан / Бүгд) and aimag (all 9 UB districts from `packages/mn` `normalizeDistrict` enum + "Бүгд"). Submits to same URL, server reads params. Changing a filter resets cursor.

### Pagination

"Дараах →" link: appends `?cursor=<base64>` preserving current status/aimag params. "← Өмнөх" is not needed (keyset forward-only pagination for MVP).

### Layout

Tailwind. Sticky filter bar above table. Table: `w-full`, `text-sm`, alternating row background. Status badge: inline `<span>` with Tailwind color classes. Responsive: on small screens, hide `aimag` column (`hidden sm:table-cell`).

---

## Files Changed

### Worker (`apps/worker`)
- `src/alerts/providers/telegram.ts` — implement `send()`
- `src/alerts/query-matching-users.ts` — new: category fan-out query
- `src/jobs/scrape-tender-gov-mn.ts` — add `boss` param, `onChanged` hook
- `src/jobs/alert-dispatch.ts` — register telegramProvider + emailProvider

### Core (`packages/core`)
- `src/types.ts` — `UpsertFn` returns `{ outcome, id }` instead of `UpsertOutcome`
- `src/pipeline.ts` — update to use new return shape

### DB adapter (`apps/worker/src/db-adapter.ts`)
- `upsertTender`, `upsertListing` — return `{ outcome, id }`

### Platform (`apps/platform`)
- `src/app/(dashboard)/dashboard/page.tsx` — full dashboard implementation
- `src/app/(dashboard)/dashboard/category-picker.tsx` — new client component
- `src/app/(dashboard)/dashboard/actions.ts` — new: `saveDashboardCategories`
- `src/app/onboarding/actions.ts` — set `alertChannels: ["telegram","email"]` default

### Tests
- `apps/worker/src/alerts/query-matching-users.test.ts` — new
- `apps/worker/src/alerts/dispatch.test.ts` — add telegram channel test
- `apps/worker/src/db-adapter.test.ts` — update for new return shape

---

## Out of Scope

- Digest mode (accumulate alerts, flush in batch) — noted as TODO in `notify-builder.ts`, stays a TODO
- Backwards pagination on the dashboard
- `/settings` page — dashboard empty state links inline picker instead
- SMS channel
