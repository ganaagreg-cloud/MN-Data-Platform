# Alert Dispatch Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the alert dispatch pipeline — `notifications_sent` DB table, email via Resend, `ChannelProvider` interface with Telegram/SMS stubs, and the pg-boss `alert.dispatch` job handler.

**Architecture:** A `dispatchAlert(payload, providers[])` function fans out to each channel in the user's subscription. Send first, log to `notifications_sent` after success — failed sends leave no record, giving pg-boss a clean retry. Per-channel errors are isolated so one failing channel does not abort others.

**Tech Stack:** Resend SDK, Drizzle ORM, Zod v4, Vitest. New DB migration for `notifications_sent` table and `users.telegram_chat_id`/`phone` columns.

**Execute after:** Plan 1 (pg-boss worker) must be complete — this plan replaces the `alert.dispatch` stub in `scheduler.ts`.

---

## File Map

| Action | Path |
|---|---|
| Modify | `packages/db/src/schema/index.ts` |
| Generate | `packages/db/migrations/0001_*.sql` |
| Modify | `apps/worker/package.json` |
| Create | `apps/worker/src/alerts/types.ts` |
| Create | `apps/worker/src/alerts/idempotency.ts` |
| Create | `apps/worker/src/alerts/notify-builder.ts` |
| Create | `apps/worker/src/alerts/providers/email.ts` |
| Create | `apps/worker/src/alerts/providers/telegram.ts` |
| Create | `apps/worker/src/alerts/providers/sms.ts` |
| Create | `apps/worker/src/alerts/dispatch.ts` |
| Create | `apps/worker/src/jobs/alert-dispatch.ts` |
| Modify | `apps/worker/src/scheduler.ts` |
| Create | `apps/worker/src/alerts/notify-builder.test.ts` |
| Create | `apps/worker/src/alerts/dispatch.test.ts` |

---

### Task 1: DB migration — `notifications_sent` + `users` columns

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Generate: migration SQL via `pnpm db:generate`

The migration adds `telegram_chat_id` and `phone` to `users`, and creates the `notifications_sent` dedup table.

- [ ] **Step 1: Update packages/db/src/schema/index.ts**

Add two columns to the `users` table definition (inside the existing `pgTable("users", { ... })` block):

```ts
// Add after the existing `name` field inside the users table:
telegramChatId: text("telegram_chat_id"),
phone:          text("phone"),
```

Add the new `notificationsSent` table after the `listings` table:

```ts
// ── notifications_sent ────────────────────────────────────────────────────────
// Idempotency log: one row per (record_id, content_hash, user_id, channel).
// record_id is text (not FK) — covers both tenders and listings.
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

Also add `notificationsSent` to the existing re-export in `packages/db/src/index.ts`:

```ts
export { db, migrationDb } from "./client.js";
export { sql } from "drizzle-orm";
export * from "./schema/index.js";
```

(The wildcard already re-exports it — no change needed here if using `export * from`.)

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new file `packages/db/migrations/0001_*.sql` is created containing:
- `ALTER TABLE "users" ADD COLUMN "telegram_chat_id" text;`
- `ALTER TABLE "users" ADD COLUMN "phone" text;`
- `CREATE TABLE "notifications_sent" (...);`
- `CREATE UNIQUE INDEX "notifications_sent_dedup_idx" ...`
- `CREATE INDEX "notifications_sent_user_idx" ...`

- [ ] **Step 3: Apply the migration**

```bash
pnpm db:migrate
```

Expected: migration applied, `pnpm db:migrate` exits 0.

- [ ] **Step 4: Typecheck db package**

```bash
cd packages/db && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(db): add notifications_sent table + users.telegram_chat_id/phone"
```

---

### Task 2: `alerts/types.ts` — shared interfaces

**Files:**
- Create: `apps/worker/src/alerts/types.ts`

- [ ] **Step 1: Create types.ts**

```ts
// apps/worker/src/alerts/types.ts

export type AlertChannel = "email" | "telegram" | "sms";

export interface Notification {
  recordId: string;
  contentHash: string;
  subject: string;
  /** Plain text. Each provider renders its own HTML wrapper if needed. */
  body: string;
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

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/alerts/types.ts
git commit -m "feat(worker): add alert dispatch types — ChannelProvider, Notification, Recipient"
```

---

### Task 3: `alerts/idempotency.ts`

**Files:**
- Create: `apps/worker/src/alerts/idempotency.ts`

- [ ] **Step 1: Create idempotency.ts**

```ts
// apps/worker/src/alerts/idempotency.ts
import { db, notificationsSent } from "@mn-platform/db";

interface InsertParams {
  recordId: string;
  contentHash: string;
  userId: string;
  channel: string;
}

/**
 * Returns true if a new row was inserted (notification is new).
 * Returns false if the row already existed (conflict — notification already logged).
 *
 * IMPORTANT: call this AFTER a successful provider.send(), not before.
 * A failed send leaves no record, giving pg-boss a clean retry path.
 */
export async function insertNotificationSent(
  params: InsertParams,
): Promise<boolean> {
  const result = await db
    .insert(notificationsSent)
    .values({
      recordId:    params.recordId,
      contentHash: params.contentHash,
      userId:      params.userId,
      channel:     params.channel,
    })
    .onConflictDoNothing()
    .returning({ id: notificationsSent.id });

  return result.length > 0;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/alerts/idempotency.ts
git commit -m "feat(worker): add insertNotificationSent idempotency helper"
```

---

### Task 4: `alerts/notify-builder.ts` — build Notification from a tender

**Files:**
- Create: `apps/worker/src/alerts/notify-builder.ts`
- Create: `apps/worker/src/alerts/notify-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/alerts/notify-builder.test.ts
import { describe, it, expect } from "vitest";
import { formatTenderNotification } from "./notify-builder.js";

const tender = {
  id: "abc-123",
  tenderNo: "ТД-2026-001",
  procuringEntity: "Улаанбаатар хот",
  category: "Барилга",
  estBudgetMnt: "500000000.00",
  submissionDeadline: new Date("2026-07-01T16:00:00.000Z"),
  aimag: "УБ",
};

describe("formatTenderNotification", () => {
  it("includes tender number in subject", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.subject).toContain("ТД-2026-001");
    expect(n.recordId).toBe("abc-123");
    expect(n.contentHash).toBe("hash123");
  });

  it("falls back to procuringEntity when tenderNo is null", () => {
    const n = formatTenderNotification({ ...tender, tenderNo: null }, "h");
    expect(n.subject).toContain("Улаанбаатар хот");
  });

  it("body contains procuringEntity and a platform link", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.body).toContain("Улаанбаатар хот");
    expect(n.body).toContain("/tender/abc-123");
  });

  it("body contains digest TODO comment", () => {
    const n = formatTenderNotification(tender, "hash123");
    expect(n.body).toContain("TODO");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `formatTenderNotification` not found.

- [ ] **Step 3: Implement notify-builder.ts**

```ts
// apps/worker/src/alerts/notify-builder.ts
import { formatMnt } from "@mn-platform/mn";
import type { Notification } from "./types.js";

interface TenderSummary {
  id: string;
  tenderNo: string | null;
  procuringEntity: string | null;
  category: string | null;
  estBudgetMnt: string | null;
  submissionDeadline: Date | null;
  aimag: string | null;
}

function formatDeadline(d: Date | null): string {
  if (!d) return "тодорхойгүй";
  return d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
}

export function formatTenderNotification(
  tender: TenderSummary,
  contentHash: string,
): Notification {
  const name = tender.tenderNo ?? tender.procuringEntity ?? tender.id;
  const deadline = formatDeadline(tender.submissionDeadline);
  const platformUrl = process.env["PLATFORM_URL"] ?? "https://tenderalert.mn";

  const body = [
    `Байгууллага: ${tender.procuringEntity ?? "—"}`,
    `Ангилал: ${tender.category ?? "—"}`,
    `Төсвийн дүн: ${tender.estBudgetMnt ? formatMnt(tender.estBudgetMnt) : "—"}`,
    `Дедлайн: ${deadline}`,
    `Аймаг/дүүрэг: ${tender.aimag ?? "—"}`,
    "",
    `Дэлгэрэнгүй: ${platformUrl}/tender/${tender.id}`,
    "",
    // TODO: digest hook — when user has digest enabled, accumulate
    //   Notification objects and flush in a scheduled batch job instead
    //   of calling provider.send() immediately. Key on (userId, digestDate).
  ].join("\n");

  return {
    recordId: tender.id,
    contentHash,
    subject: `Шинэ тендер: ${name} — дедлайн ${deadline}`,
    body,
  };
}
```

- [ ] **Step 4: Run test — verify all pass**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass (including the 2 health tests from Plan 1).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/alerts/notify-builder.ts apps/worker/src/alerts/notify-builder.test.ts
git commit -m "feat(worker): add formatTenderNotification with Mongolian subject/body"
```

---

### Task 5: Channel providers — Resend email + stubs

**Files:**
- Modify: `apps/worker/package.json` (add `resend`)
- Create: `apps/worker/src/alerts/providers/email.ts`
- Create: `apps/worker/src/alerts/providers/telegram.ts`
- Create: `apps/worker/src/alerts/providers/sms.ts`

- [ ] **Step 1: Add resend dependency**

In `apps/worker/package.json`, add to `"dependencies"`:

```json
"resend": "^4.0.0"
```

Then run:

```bash
pnpm install
```

- [ ] **Step 2: Create providers/email.ts**

```ts
// apps/worker/src/alerts/providers/email.ts
import { Resend } from "resend";
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class ResendEmailProvider implements ChannelProvider {
  readonly channel = "email" as const;
  private readonly resend: Resend;
  private readonly from: string;

  constructor(resend: Resend, from: string) {
    this.resend = resend;
    this.from = from;
  }

  async send(notification: Notification, recipient: Recipient): Promise<void> {
    const html = `
      <table style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <tr><td><h2 style="color:#1a1a1a">${escapeHtml(notification.subject)}</h2></td></tr>
        <tr><td><pre style="white-space:pre-wrap;font-family:sans-serif;color:#333">
${escapeHtml(notification.body)}</pre></td></tr>
      </table>
    `;

    const { error } = await this.resend.emails.send({
      from:    this.from,
      to:      recipient.email,
      subject: notification.subject,
      html,
      text:    notification.body,
    });

    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 3: Create providers/telegram.ts**

```ts
// apps/worker/src/alerts/providers/telegram.ts
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class TelegramProvider implements ChannelProvider {
  readonly channel = "telegram" as const;

  async send(_notification: Notification, _recipient: Recipient): Promise<void> {
    throw new Error("TelegramProvider: not yet implemented");
  }
}
```

- [ ] **Step 4: Create providers/sms.ts**

```ts
// apps/worker/src/alerts/providers/sms.ts
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class SmsProvider implements ChannelProvider {
  readonly channel = "sms" as const;

  async send(_notification: Notification, _recipient: Recipient): Promise<void> {
    throw new Error("SmsProvider: not yet implemented");
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/alerts/providers/ apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): add ResendEmailProvider + Telegram/SMS stubs"
```

---

### Task 6: `alerts/dispatch.ts` — fan-out logic

**Files:**
- Create: `apps/worker/src/alerts/dispatch.ts`
- Create: `apps/worker/src/alerts/dispatch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/alerts/dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelProvider, Notification, Recipient, AlertJobPayload } from "./types.js";

// Mock the DB module — tests don't need a real connection
vi.mock("@mn-platform/db", () => {
  const mockUser = {
    id: "user-1",
    orgId: "org-1",
    email: "test@example.com",
    telegramChatId: null,
    phone: null,
  };
  const mockSubscription = {
    id: "sub-1",
    orgId: "org-1",
    status: "active",
    alertChannels: ["email"],
    modules: ["tender"],
  };
  const mockTender = {
    id: "tender-1",
    tenderNo: "ТД-001",
    procuringEntity: "Test Org",
    category: "IT",
    estBudgetMnt: "1000000.00",
    submissionDeadline: new Date("2026-07-01T00:00:00Z"),
    aimag: "УБ",
  };

  return {
    db: {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(mockUser),
        },
        subscriptions: {
          findFirst: vi.fn().mockResolvedValue(mockSubscription),
        },
        tenders: {
          findFirst: vi.fn().mockResolvedValue(mockTender),
        },
      },
    },
    users: { id: "users.id" },
    subscriptions: { orgId: "subscriptions.orgId", status: "subscriptions.status" },
    tenders: { id: "tenders.id" },
    notificationsSent: {},
  };
});

// Mock idempotency — always returns true (new notification)
vi.mock("./idempotency.js", () => ({
  insertNotificationSent: vi.fn().mockResolvedValue(true),
}));

// Re-import after mocks are set up
const { dispatchAlert } = await import("./dispatch.js");
const { insertNotificationSent } = await import("./idempotency.js");

function makeProvider(channel: "email" | "telegram" | "sms"): ChannelProvider & { send: ReturnType<typeof vi.fn> } {
  return { channel, send: vi.fn().mockResolvedValue(undefined) };
}

const payload: AlertJobPayload = {
  recordId: "tender-1",
  contentHash: "hash-abc",
  userId: "user-1",
};

describe("dispatchAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls send on the email provider", async () => {
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it("calls insertNotificationSent after successful send", async () => {
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(insertNotificationSent).toHaveBeenCalledWith({
      recordId: "tender-1",
      contentHash: "hash-abc",
      userId: "user-1",
      channel: "email",
    });
  });

  it("does not abort other channels when one fails", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "active",
      alertChannels: ["email", "sms"], modules: ["tender"],
    });

    const emailProvider = makeProvider("email");
    const smsProvider = makeProvider("sms");
    smsProvider.send.mockRejectedValueOnce(new Error("SMS failed"));

    // Should throw because one channel failed, but email was still called
    await expect(dispatchAlert(payload, [emailProvider, smsProvider])).rejects.toThrow("SMS failed");
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it("returns without dispatching when subscription is inactive", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "expired",
      alertChannels: ["email"], modules: ["tender"],
    });
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(emailProvider.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `dispatch.js` not found.

- [ ] **Step 3: Implement dispatch.ts**

```ts
// apps/worker/src/alerts/dispatch.ts
import { eq, and } from "drizzle-orm";
import { db, users, subscriptions, tenders } from "@mn-platform/db";
import type { ChannelProvider, AlertJobPayload } from "./types.js";
import { formatTenderNotification } from "./notify-builder.js";
import { insertNotificationSent } from "./idempotency.js";
import { logger } from "../logger.js";

export async function dispatchAlert(
  payload: AlertJobPayload,
  providers: ChannelProvider[],
): Promise<void> {
  // Step 1: load user
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });
  if (!user) {
    logger.warn({ userId: payload.userId }, "dispatchAlert: user not found — skipping");
    return;
  }

  // Step 1b: load subscription
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.orgId, user.orgId),
    ),
  });
  if (!subscription) {
    logger.warn({ userId: payload.userId }, "dispatchAlert: subscription not found — skipping");
    return;
  }

  // Step 2: gate — active subscriptions only
  if (subscription.status !== "active") {
    logger.info(
      { userId: payload.userId, status: subscription.status },
      "dispatchAlert: subscription not active — skipping",
    );
    return;
  }

  // Step 3: load tender
  const tender = await db.query.tenders.findFirst({
    where: eq(tenders.id, payload.recordId),
  });
  if (!tender) {
    logger.warn({ recordId: payload.recordId }, "dispatchAlert: tender not found — skipping");
    return;
  }

  // Step 4-5: build notification + recipient
  const notification = formatTenderNotification(tender, payload.contentHash);
  const recipient = {
    userId:          user.id,
    email:           user.email,
    telegramChatId:  user.telegramChatId ?? undefined,
    phone:           user.phone ?? undefined,
  };

  const errors: Error[] = [];

  // Step 6: fan out to each subscribed channel
  for (const channel of subscription.alertChannels) {
    const provider = providers.find((p) => p.channel === channel);
    if (!provider) {
      logger.warn({ channel }, "dispatchAlert: no provider registered for channel — skipping");
      continue;
    }

    // Channel gates
    if (channel === "telegram" && !recipient.telegramChatId) {
      logger.info({ userId: user.id }, "dispatchAlert: telegram_chat_id not set — skipping telegram");
      continue;
    }

    try {
      await provider.send(notification, recipient);
      await insertNotificationSent({
        recordId:    payload.recordId,
        contentHash: payload.contentHash,
        userId:      payload.userId,
        channel,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ channel, userId: user.id, message: error.message }, "channel dispatch failed");
      errors.push(error);
    }
  }

  // Re-throw first error so pg-boss retries the job.
  // Channels that succeeded have a notifications_sent row and will be skipped on retry.
  if (errors.length > 0) {
    throw errors[0]!;
  }
}
```

- [ ] **Step 4: Run test — verify all pass**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/alerts/dispatch.ts apps/worker/src/alerts/dispatch.test.ts
git commit -m "feat(worker): add dispatchAlert fan-out with per-channel error isolation"
```

---

### Task 7: `jobs/alert-dispatch.ts` — pg-boss handler

**Files:**
- Create: `apps/worker/src/jobs/alert-dispatch.ts`

- [ ] **Step 1: Create alert-dispatch.ts**

```ts
// apps/worker/src/jobs/alert-dispatch.ts
import { Resend } from "resend";
import { z } from "zod";
import { dispatchAlert } from "../alerts/dispatch.js";
import { ResendEmailProvider } from "../alerts/providers/email.js";
import { logger } from "../logger.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

const AlertJobPayloadSchema = z.object({
  recordId:    z.string().uuid(),
  contentHash: z.string().min(1),
  userId:      z.string().uuid(),
});

// Singleton — constructed once at worker startup.
function createEmailProvider(): ResendEmailProvider {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from   = requireEnv("RESEND_FROM");
  return new ResendEmailProvider(new Resend(apiKey), from);
}

export const emailProvider = createEmailProvider();

export function makeAlertDispatchHandler() {
  return async function handler([job]: Array<{ data: unknown }>) {
    // Zod throws on invalid payload → pg-boss marks job failed, no retry
    // (a bad payload will never improve on retries)
    const payload = AlertJobPayloadSchema.parse(job.data);
    await dispatchAlert(payload, [emailProvider]);
    // TODO: add telegramProvider, smsProvider when implemented
    logger.info({ recordId: payload.recordId, userId: payload.userId }, "alert dispatched");
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/jobs/alert-dispatch.ts
git commit -m "feat(worker): add alert-dispatch pg-boss handler with Zod validation"
```

---

### Task 8: Wire handler into `scheduler.ts`

**Files:**
- Modify: `apps/worker/src/scheduler.ts`

Replace the `alert.dispatch` stub with the real handler.

- [ ] **Step 1: Update scheduler.ts**

Add the import at the top of `apps/worker/src/scheduler.ts`:

```ts
import { makeAlertDispatchHandler } from "./jobs/alert-dispatch.js";
```

Replace the `alert.dispatch` stub block:

```ts
// ── alert.dispatch ──────────────────────────────────────────────────────────
await boss.work(
  "alert.dispatch",
  { localConcurrency: 5 },
  makeAlertDispatchHandler(),
);
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run all tests**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/scheduler.ts
git commit -m "feat(worker): wire alert.dispatch handler — replaces stub"
```

---

### Task 9: Final typecheck + lint

- [ ] **Step 1: Full monorepo typecheck**

```bash
pnpm typecheck
```

Expected: all packages exit 0.

- [ ] **Step 2: Full lint**

```bash
pnpm lint
```

Expected: exits 0.

- [ ] **Step 3: Run all tests**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore(worker): apply lint fixes — alert pipeline"
```
