# Alert Dispatch Pipeline

**Date:** 2026-06-10
**Status:** Approved

## Goal

Implement the alert dispatch pipeline as a separate pg-boss stage from ingestion:
- Fan out `alert.dispatch` jobs to subscribed channels.
- Email via Resend (active). Telegram and SMS behind `ChannelProvider` stubs (not wired).
- Idempotency: `notifications_sent` log, keyed on `(record_id, content_hash, user_id, channel)`. **Send first; insert after success only.** A failed send leaves no record → clean pg-boss retry.
- Gate on `subscription.status === 'active'` before any dispatch.

---

## Deviations from alert-pipeline skill defaults

| Skill default | This implementation | Reason |
|---|---|---|
| Insert into `notifications_sent` **before** send | Insert **after** send succeeds | pg-boss dequeues each job to exactly one worker; no race to protect. Avoids dead-claim problem where send fails but slot is reserved, leaving the user without a notification. |
| Instant email + digest opt-in | Instant only | Digest deferred. `// TODO` left at hook point. |

---

## File Layout

```
packages/db/src/schema/index.ts        ← add notifications_sent table + users.telegram_chat_id/phone
packages/db/migrations/0001_*.sql      ← generated migration

apps/worker/src/
  alerts/
    types.ts                           ← ChannelProvider, Notification, Recipient
    dispatch.ts                        ← dispatchAlert(payload, db, providers[])
    notify-builder.ts                  ← formatTenderNotification(tender) → {subject, body}
    idempotency.ts                     ← insertNotificationSent() → boolean
    providers/
      email.ts                         ← ResendEmailProvider implements ChannelProvider
      telegram.ts                      ← TelegramProvider stub
      sms.ts                           ← SmsProvider stub
  jobs/
    alert-dispatch.ts                  ← pg-boss handler
```

---

## DB Changes (migration 0001)

### `users` table — two new nullable columns

```sql
ALTER TABLE users ADD COLUMN telegram_chat_id text;
ALTER TABLE users ADD COLUMN phone text;
```

Added via Drizzle schema first; migration generated with `pnpm db:generate`.

### New table: `notifications_sent`

```sql
CREATE TABLE notifications_sent (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id     text    NOT NULL,
  content_hash  text    NOT NULL,
  user_id       uuid    NOT NULL REFERENCES users(id),
  channel       text    NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notifications_sent_dedup_idx
  ON notifications_sent (record_id, content_hash, user_id, channel);

CREATE INDEX notifications_sent_user_idx ON notifications_sent (user_id);
```

`record_id` is `text` (not a UUID FK) so it covers both tenders and listings without a union FK.

### Drizzle schema additions

In `packages/db/src/schema/index.ts`:

```ts
// users additions
telegramChatId: text("telegram_chat_id"),
phone:          text("phone"),

// new table
export const notificationsSent = pgTable(
  "notifications_sent",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    recordId:    text("record_id").notNull(),
    contentHash: text("content_hash").notNull(),
    userId:      uuid("user_id").references(() => users.id).notNull(),
    channel:     text("channel").notNull(),
    sentAt:      timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notifications_sent_dedup_idx")
      .on(t.recordId, t.contentHash, t.userId, t.channel),
    index("notifications_sent_user_idx").on(t.userId),
  ],
);
```

---

## Interfaces (`alerts/types.ts`)

```ts
export type AlertChannel = "email" | "telegram" | "sms";

export interface Notification {
  recordId: string;
  contentHash: string;
  subject: string;
  body: string; // plain text; each provider renders its own template
}

export interface Recipient {
  userId: string;
  email: string;
  telegramChatId?: string;
  phone?: string;
}

export interface ChannelProvider {
  channel: AlertChannel;
  send(notification: Notification, recipient: Recipient): Promise<void>;
}

export interface AlertJobPayload {
  recordId: string;
  contentHash: string;
  userId: string;
}
```

---

## `alerts/dispatch.ts`

Function: `dispatchAlert(payload: AlertJobPayload, db, providers: ChannelProvider[]): Promise<void>`

### Flow

1. Load user + subscription in parallel. If user or subscription not found, log and return (no-op — stale job).
2. **Gate:** if `subscription.status !== 'active'`, log and return. No dispatch.
3. Load tender by `payload.recordId`. If not found, log and return.
4. Build `Notification` via `formatTenderNotification(tender, payload.contentHash)`.
5. Build `Recipient` from user fields.
6. For each channel in `subscription.alert_channels`:
   a. Find the matching `ChannelProvider`. Skip unknown channels (log warning).
   b. Channel gates:
      - `email`: always pass.
      - `telegram`: skip if `recipient.telegramChatId` is absent (stub not wired anyway).
      - `sms`: skip if channel not in subscription (stub not wired anyway).
   c. `await provider.send(notification, recipient)` — **if send throws, go to error collection.**
   d. On success: `await insertNotificationSent(db, { recordId, contentHash, userId, channel })`.
      - If `insertNotificationSent` returns `false` (duplicate): this was a retry where send succeeded again but the record was already logged — benign. The duplicate email is accepted as the cost of send-first ordering. No action.
   e. Per-channel errors are caught and collected; a failure on one channel does not abort others.
7. After all channels: if any errors were collected, throw the first one → pg-boss retries the job. Channels that succeeded are recorded in `notifications_sent`; on retry their `insertNotificationSent` returns `false` so they are skipped.

### Error / retry behaviour

- pg-boss job sent with `{ retryLimit: 3, retryBackoff: true }`.
- On retry: `provider.send()` is called again for failed channels; succeeded channels' `insertNotificationSent` still inserts (send-first), but the insert is a no-op conflict on the second attempt. The duplicate send on retry is accepted trade-off; retries should be rare (network blip only).

---

## `alerts/idempotency.ts`

```ts
insertNotificationSent(
  db,
  params: { recordId; contentHash; userId; channel }
): Promise<boolean>  // true = inserted; false = conflict (already sent)
```

Uses Drizzle `insert(...).onConflictDoNothing().returning({ id: notificationsSent.id })`.
Returns `true` if the returning array is non-empty, `false` if empty (conflict).

---

## `alerts/notify-builder.ts`

`formatTenderNotification(tender, contentHash): Notification`

- **subject:** `Шинэ тендер: {tenderNo ?? procuringEntity ?? tender.id} — дедлайн {formatDeadline(submissionDeadline)}`
- **body:** plain-text block:
  ```
  Байгууллага: {procuringEntity}
  Ангилал: {category}
  Төсвийн дүн: {formatMnt(estBudgetMnt)}
  Дэдлайн: {submissionDeadline}
  Аймаг: {aimag}
  
  Дэлгэрэнгүй: {PLATFORM_URL}/tender/{tender.id}
  
  // TODO: digest hook — when user has digest enabled, accumulate
  //   Notification objects and flush in a scheduled batch job instead
  //   of calling provider.send() immediately. Key on (userId, digestDate).
  ```
- Uses `formatMnt` from `@mn-platform/mn` for money fields.
- `formatDeadline`: `submissionDeadline?.toLocaleDateString("mn-MN") ?? "тодорхойгүй"`.

---

## `alerts/providers/email.ts` — `ResendEmailProvider`

Implements `ChannelProvider` with `channel: "email"`.

Constructor takes `resend: Resend` (injected, not constructed inside). Reads `RESEND_FROM` from env at construction time.

`send(notification, recipient)`:
- Calls `resend.emails.send({ from, to: recipient.email, subject, html, text })`.
- `html`: notification body wrapped in a minimal HTML table (no raw scraped listing content).
- `text`: `notification.body` directly.
- Throws on non-2xx from Resend; pg-boss handles retry.

---

## `alerts/providers/telegram.ts` and `sms.ts`

Both throw `new Error("not implemented")` from `send()`. Registered in types but not passed to the handler until implemented.

---

## `jobs/alert-dispatch.ts` — pg-boss handler

```ts
const AlertJobPayloadSchema = z.object({
  recordId: z.string().uuid(),
  contentHash: z.string().min(1),
  userId: z.string().uuid(),
});

async ([job]) => {
  const payload = AlertJobPayloadSchema.parse(job.data);
  await dispatchAlert(payload, db, [emailProvider]);
  // TODO: add telegramProvider, smsProvider when implemented
}
```

`job.data` is treated as external input — Zod parse throws on invalid shape, which marks the job `failed` in pg-boss (no retry, since a malformed payload will never succeed).

`emailProvider` is a module-level singleton (constructed once when the worker boots).

---

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key; never logged |
| `RESEND_FROM` | Yes | e.g. `TenderAlert <alerts@tenderalert.mn>` |
| `PLATFORM_URL` | Yes | Base URL for tender deep-links in email body |

---

## Definition of Done

All gates from `CLAUDE.md` must pass:

- [ ] `pnpm typecheck` passes — no `any`.
- [ ] `pnpm lint` passes.
- [ ] `notifications_sent` unique constraint verified idempotent (re-running the same job produces no duplicate rows after the first).
- [ ] All external input (job payload) validated with Zod before touching the DB.
- [ ] `RESEND_API_KEY`, `RESEND_FROM`, `PLATFORM_URL` read from env only — not logged.
- [ ] Per-channel failure does not abort other channels (verified by unit test or manual inspection).
- [ ] Migration `0001` applies cleanly on top of `0000`.
