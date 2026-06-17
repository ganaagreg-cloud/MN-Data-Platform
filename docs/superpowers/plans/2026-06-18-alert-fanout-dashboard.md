# Alert Fan-out + Tender Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real per-user Telegram alerts when tenders are new/updated, and build the `/dashboard` page showing matching tenders per user's subscription categories.

**Architecture:** Extend `UpsertFn`/`onChanged` to return and receive the DB row UUID; the scrape job's `onChanged` fan-outs to per-user `alert.dispatch` pg-boss jobs. The dashboard is a Next.js 15 RSC with keyset pagination and an inline `CategoryPicker` empty-state component.

**Tech Stack:** TypeScript strict, Drizzle ORM, pg-boss, Telegram Bot API (`sendTelegramMessageTo` from `@mn-platform/core`), Next.js 15 App Router, Tailwind v4.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `packages/core/src/types.ts` | Modify | `UpsertFn` returns `{ outcome, id }`; `onChanged` gains `dbId?: string` 4th param |
| `packages/core/src/pipeline.ts` | Modify | Destructure `{ outcome, id }` from upsert; pass `dbId` to `onChanged` |
| `packages/core/src/pipeline.test.ts` | Modify | Update all `upsert` mocks + `onChanged` assertion args |
| `apps/worker/src/listing-pipeline.test.ts` | Modify | Update `upsert` mock shape |
| `apps/worker/src/db-adapter.ts` | Modify | `upsertTender` + `upsertListing` return `{ outcome, id }` via `.returning()` |
| `apps/worker/src/db-adapter.test.ts` | Modify | Chain `.returning()` in insert mock; add return-value assertion |
| `apps/worker/src/alerts/providers/telegram.ts` | Modify | Implement `send()` using `sendTelegramMessageTo` |
| `apps/worker/src/alerts/dispatch.test.ts` | Modify | Add telegram channel test |
| `apps/worker/src/alerts/query-matching-users.ts` | Create | Queries users matching a tender category |
| `apps/worker/src/alerts/query-matching-users.test.ts` | Create | Unit tests for `queryMatchingUsers` |
| `apps/worker/src/scheduler.ts` | Modify | Tender `onChanged` fans out to `alert.dispatch` jobs |
| `apps/worker/src/jobs/alert-dispatch.ts` | Modify | Register `TelegramProvider` + `emailProvider` |
| `apps/platform/src/app/onboarding/actions.ts` | Modify | `saveModules` sets `alertChannels: ["telegram","email"]` |
| `apps/platform/src/app/(dashboard)/dashboard/actions.ts` | Create | `saveDashboardCategories` server action |
| `apps/platform/src/app/(dashboard)/dashboard/category-picker.tsx` | Create | Client component — inline category picker for empty state |
| `apps/platform/src/app/(dashboard)/dashboard/page.tsx` | Modify | Full dashboard with table, filters, keyset pagination |

---

## Task 1: Update `UpsertFn` return type and `onChanged` signature in `packages/core`

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/pipeline.test.ts`

- [ ] **Step 1: Update `types.ts`**

Replace the `UpsertFn` type and the `onChanged` signature in `RunPipelineOptions`:

```typescript
// packages/core/src/types.ts
// Change UpsertFn return type:
export type UpsertFn<TRecord> = (
  sourceId: string,
  contentHash: string,
  record: TRecord,
) => Promise<{ outcome: UpsertOutcome; id: string }>;
```

In `pipeline.ts`'s `RunPipelineOptions`, change `onChanged`:

```typescript
// packages/core/src/pipeline.ts — RunPipelineOptions interface
onChanged?: (
  record: TRecord,
  outcome: "created" | "updated",
  previous?: Partial<TRecord>,
  dbId?: string,
) => void | Promise<void>;
```

- [ ] **Step 2: Update `pipeline.ts` body to use new return shape**

Replace the upsert call and the `onChanged` invocation:

```typescript
// packages/core/src/pipeline.ts — inside the for loop, replacing old upsert lines:
const hash = source.contentHash(validated);
const previous = await getPrevious?.(validated);
const { outcome, id: dbId } = await upsert(source.id, hash, validated);
if (outcome === "created") created++;
else if (outcome === "updated") updated++;

if (outcome !== "unchanged") {
  await onChanged?.(validated, outcome, previous, dbId);
}
```

- [ ] **Step 3: Update `pipeline.test.ts` — all `upsert` mocks return `{ outcome, id }`**

Replace every `vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("X")` with the object shape. Also remove `UpsertOutcome` from the import (no longer used in tests). Update all `onChanged` call assertions to include the new 4th arg:

```typescript
// packages/core/src/pipeline.test.ts — top of file
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./pipeline.js";
import type { Source } from "./types.js";
import { z } from "zod";

// In every test, change upsert mocks:
// "created"  →  { outcome: "created",  id: "uuid-1" }
// "updated"  →  { outcome: "updated",  id: "uuid-1" }
// "unchanged"→  { outcome: "unchanged", id: "uuid-1" }

// Example — "upserts a record and returns new=1":
const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
expect(upsert).toHaveBeenCalledWith("test.source", "hash-abc", record);
expect(result.new).toBe(1);

// Update "calls onChanged with the outcome..." test:
expect(onChanged).toHaveBeenNthCalledWith(1, record, "created", undefined, "uuid-1");
expect(onChanged).toHaveBeenNthCalledWith(2, { id: "T-002", value: 2 }, "updated", undefined, "uuid-1");

// Update "threads getPrevious result through to onChanged":
expect(onChanged).toHaveBeenCalledWith(record, "updated", previous, "uuid-1");

// The "does not call onChanged for unchanged" test mock:
const upsert = vi.fn().mockResolvedValue({ outcome: "unchanged", id: "uuid-1" });
```

Full updated file (replace in place — every `vi.fn<() => Promise<UpsertOutcome>>` becomes `vi.fn()`):

```typescript
// packages/core/src/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./pipeline.js";
import type { Source } from "./types.js";
import { z } from "zod";

interface TestRecord {
  id: string;
  value: number;
}

const record: TestRecord = { id: "T-001", value: 1 };

const schema = z.object({
  id: z.string(),
  value: z.number(),
});

describe("runPipeline", () => {
  it("upserts a record and returns new=1", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(upsert).toHaveBeenCalledWith("test.source", "hash-abc", record);
    expect(result.new).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.fetched).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("counts an 'updated' outcome from upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "updated", id: "uuid-1" });
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.new).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("skips records where source.filter returns false", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    const result = await runPipeline({ source, upsert });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.new).toBe(0);
  });

  it("counts pagesFetched and emptyPages across multiple pages", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    let call = 0;
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => {
        call++;
        if (call === 1) return { raw: [], nextCursor: "2" };
        if (call === 2) return { raw: [record], nextCursor: "3" };
        return { raw: [] };
      },
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.pagesFetched).toBe(3);
    expect(result.emptyPages).toBe(2);
  });

  it("emptyPages equals pagesFetched when every page returns zero rows", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.pagesFetched).toBe(1);
    expect(result.emptyPages).toBe(1);
  });

  it("calls onValidated for each validated record, even when the filter skips it", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const onValidated = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    const result = await runPipeline({ source, upsert, onValidated });

    expect(onValidated).toHaveBeenCalledWith(record);
    expect(result.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("calls onChanged with the outcome and dbId for created and updated records", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "created", id: "uuid-1" })
      .mockResolvedValueOnce({ outcome: "updated", id: "uuid-1" });
    const onChanged = vi.fn();
    let call = 0;
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => {
        call++;
        if (call === 1) return { raw: [record], nextCursor: "2" };
        return { raw: [{ id: "T-002", value: 2 }] };
      },
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, onChanged });

    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenNthCalledWith(1, record, "created", undefined, "uuid-1");
    expect(onChanged).toHaveBeenNthCalledWith(2, { id: "T-002", value: 2 }, "updated", undefined, "uuid-1");
  });

  it("does not call onChanged for an 'unchanged' outcome", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "unchanged", id: "uuid-1" });
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, onChanged });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not call getPrevious or onChanged for records skipped by the filter", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const getPrevious = vi.fn();
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    await runPipeline({ source, upsert, getPrevious, onChanged });

    expect(getPrevious).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("threads getPrevious's result through to onChanged", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "updated", id: "uuid-1" });
    const previous = { id: "T-001", value: 0 };
    const getPrevious = vi.fn().mockResolvedValue(previous);
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, getPrevious, onChanged });

    expect(getPrevious).toHaveBeenCalledWith(record);
    expect(onChanged).toHaveBeenCalledWith(record, "updated", previous, "uuid-1");
  });

  it("logs row_error and continues when schema validation fails", async () => {
    const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
    const source: Source<unknown, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [{ id: "bad", value: "not-a-number" }] }),
      parse: (r) => r as TestRecord,
      schema,
      contentHash: () => "hash-abc",
    };

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline({ source, upsert });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(result.fetched).toBe(1);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Update `listing-pipeline.test.ts`**

```typescript
// apps/worker/src/listing-pipeline.test.ts
// Change:
import type { Source, ListingRecord, UpsertOutcome } from "@mn-platform/core";
// To:
import type { Source, ListingRecord } from "@mn-platform/core";

// Change:
const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
// To:
const upsert = vi.fn().mockResolvedValue({ outcome: "created", id: "uuid-1" });
```

- [ ] **Step 5: Run tests — expect pipeline.test.ts and listing-pipeline.test.ts to pass**

```
pnpm --filter @mn-platform/core run test
pnpm --filter @mn-platform/worker run test -- src/listing-pipeline.test.ts
```

Expected: all pass (the type errors in db-adapter.ts will appear at typecheck, not at test time).

- [ ] **Step 6: Commit**

```
git add packages/core/src/types.ts packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts apps/worker/src/listing-pipeline.test.ts
git commit -m "feat(core): UpsertFn returns {outcome,id}; onChanged receives dbId"
```

---

## Task 2: Update `db-adapter.ts` to return `{ outcome, id }`

**Files:**
- Modify: `apps/worker/src/db-adapter.ts`
- Modify: `apps/worker/src/db-adapter.test.ts`

- [ ] **Step 1: Update `upsertTender` in `db-adapter.ts`**

The select-then-insert/update pattern already captures `row.id` for existing rows. For inserts, add `.returning()`. Change the return type on `upsertTender` (and the `DbAdapter` interface's `upsertTender` field — this is inherited from `UpsertFn<TenderRecord>` which we already changed in Task 1, so the interface is already correct via the type). Replace the three return statements:

```typescript
// apps/worker/src/db-adapter.ts — upsertTender

// INSERT path — change:
await db.insert(tenders).values({ ... });
return "created";
// To:
const [inserted] = await db.insert(tenders).values({
  sourceId,
  externalId:         record.externalId,
  contentHash,
  firstSeenAt:        now,
  lastSeenAt:         now,
  tenderNo:           record.tenderNo,
  procuringEntity:    record.procuringEntity,
  category:           record.category,
  estBudgetMnt:       record.estBudgetMnt,
  announceDate:       record.announceDate,
  submissionDeadline: record.submissionDeadline,
  bidSecurityMnt:     record.bidSecurityMnt,
  aimag:              record.aimag,
  status:             record.status,
  fetchedVia:         record.fetchedVia,
  raw:                record.raw,
}).returning({ id: tenders.id });
return { outcome: "created", id: inserted!.id };

// UNCHANGED path — change:
return "unchanged";
// To:
return { outcome: "unchanged", id: row.id };

// UPDATED path — change:
return "updated";
// To:
return { outcome: "updated", id: row.id };
```

Also change the return type annotation on `upsertTender`:
```typescript
async upsertTender(
  sourceId: string,
  contentHash: string,
  record: TenderRecord,
): Promise<{ outcome: UpsertOutcome; id: string }> {
```

- [ ] **Step 2: Update `upsertListing` in `db-adapter.ts`**

Same pattern — INSERT returns `{ outcome: "created", id }`, others return `{ outcome, id: row.id }`:

```typescript
async upsertListing(
  sourceId: string,
  contentHash: string,
  record: ListingRecord,
): Promise<{ outcome: UpsertOutcome; id: string }> {
  // ... select ...
  if (existing.length === 0) {
    const [inserted] = await db.insert(listings).values({
      sourceId,
      externalId:  record.externalId,
      contentHash,
      firstSeenAt: now,
      lastSeenAt:  now,
      listingType: record.listingType,
      district:    record.district,
      khoroo:      record.khoroo,
      rooms:       record.rooms,
      areaM2:      record.areaM2     != null ? record.areaM2.toFixed(2)     : null,
      floor:       record.floor,
      building:    record.building,
      priceMnt:    record.priceMnt   != null ? record.priceMnt.toFixed(2)   : null,
      pricePerM2:  record.pricePerM2 != null ? record.pricePerM2.toFixed(2) : null,
      raw:         record.raw,
    }).returning({ id: listings.id });
    return { outcome: "created", id: inserted!.id };
  }

  const row = existing[0]!;

  if (row.contentHash === contentHash) {
    await db.update(listings).set({ lastSeenAt: now }).where(eq(listings.id, row.id));
    return { outcome: "unchanged", id: row.id };
  }

  await db.update(listings).set({
    contentHash,
    lastSeenAt:  now,
    listingType: record.listingType,
    district:    record.district,
    khoroo:      record.khoroo,
    rooms:       record.rooms,
    areaM2:      record.areaM2     != null ? record.areaM2.toFixed(2)     : null,
    floor:       record.floor,
    building:    record.building,
    priceMnt:    record.priceMnt   != null ? record.priceMnt.toFixed(2)   : null,
    pricePerM2:  record.pricePerM2 != null ? record.pricePerM2.toFixed(2) : null,
    raw:         record.raw,
  }).where(eq(listings.id, row.id));
  return { outcome: "updated", id: row.id };
}
```

- [ ] **Step 3: Update `db-adapter.test.ts` — fix insert mock and add return value assertion**

The existing test mocks `db.insert().values()` but now the chain is `.insert().values().returning()`. Update the mock and add a return value check:

```typescript
// apps/worker/src/db-adapter.test.ts
// In the "looks up the existing row" test, the mock drives an insert path.
// Update db.insert mock:
vi.mocked(db.insert).mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: "listing-uuid-1" }]),
  }),
} as never);

// Add assertion on the return value:
const result = await createDbAdapter().upsertListing("unegui.mn", "hash1", rentRecord);
expect(result.outcome).toBe("created");
expect(result.id).toBe("listing-uuid-1");
```

Full replacement for the first `describe` block:

```typescript
describe("createDbAdapter().upsertListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns outcome=created and the new id on insert", async () => {
    const whereSpy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: whereSpy }),
    } as never);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "listing-uuid-1" }]),
      }),
    } as never);

    const result = await createDbAdapter().upsertListing("unegui.mn", "hash1", rentRecord);

    expect(result.outcome).toBe("created");
    expect(result.id).toBe("listing-uuid-1");
    const [condition] = whereSpy.mock.calls[0]!;
    const { sql } = dialect.sqlToQuery(condition);
    expect(sql).toContain('"source_id"');
    expect(sql).toContain('"external_id"');
    expect(sql).toContain('"listing_type"');
  });
});
```

- [ ] **Step 4: Run typecheck and tests**

```
pnpm typecheck
pnpm --filter @mn-platform/worker run test -- src/db-adapter.test.ts
```

Expected: typecheck clean, test passes.

- [ ] **Step 5: Commit**

```
git add apps/worker/src/db-adapter.ts apps/worker/src/db-adapter.test.ts
git commit -m "feat(worker): db-adapter upserts return {outcome,id}"
```

---

## Task 3: Implement `TelegramProvider` and add a dispatch test for it

**Files:**
- Modify: `apps/worker/src/alerts/providers/telegram.ts`
- Modify: `apps/worker/src/alerts/dispatch.test.ts`

- [ ] **Step 1: Implement `TelegramProvider.send()`**

```typescript
// apps/worker/src/alerts/providers/telegram.ts
import { sendTelegramMessageTo } from "@mn-platform/core";
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class TelegramProvider implements ChannelProvider {
  readonly channel = "telegram" as const;

  async send(notification: Notification, recipient: Recipient): Promise<void> {
    if (!recipient.telegramChatId) {
      throw new Error("TelegramProvider: recipient.telegramChatId is required");
    }
    await sendTelegramMessageTo(recipient.telegramChatId, notification.body);
  }
}
```

- [ ] **Step 2: Add telegram channel test to `dispatch.test.ts`**

Add this test inside the existing `describe("dispatchAlert")` block. The test checks that when `alertChannels: ["telegram"]` and `telegramChatId` is set, the telegram provider's `send` is called:

```typescript
// Add to apps/worker/src/alerts/dispatch.test.ts — inside describe("dispatchAlert")

it("dispatches via telegram when alertChannels includes telegram and chatId is set", async () => {
  const { db } = await import("@mn-platform/db");
  (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: "user-1",
    orgId: "org-1",
    email: null,
    telegramChatId: "-1001234567890",
    phone: null,
  });
  (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: "sub-1",
    orgId: "org-1",
    status: "active",
    alertChannels: ["telegram"],
    modules: ["tender"],
  });

  const telegramProvider = makeProvider("telegram");
  await dispatchAlert(payload, [telegramProvider]);

  expect(telegramProvider.send).toHaveBeenCalledOnce();
  expect(telegramProvider.send).toHaveBeenCalledWith(
    expect.objectContaining({ recordId: "tender-1" }),
    expect.objectContaining({ telegramChatId: "-1001234567890" }),
  );
});

it("skips telegram when telegramChatId is null", async () => {
  const { db } = await import("@mn-platform/db");
  (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: "sub-1", orgId: "org-1", status: "active",
    alertChannels: ["telegram"], modules: ["tender"],
  });

  const telegramProvider = makeProvider("telegram");
  await dispatchAlert(payload, [telegramProvider]);

  // Default mockUser has telegramChatId: null
  expect(telegramProvider.send).not.toHaveBeenCalled();
  expect(insertNotificationSent).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests**

```
pnpm --filter @mn-platform/worker run test -- src/alerts/dispatch.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```
git add apps/worker/src/alerts/providers/telegram.ts apps/worker/src/alerts/dispatch.test.ts
git commit -m "feat(worker): implement TelegramProvider + dispatch tests"
```

---

## Task 4: Add `queryMatchingUsers`

**Files:**
- Create: `apps/worker/src/alerts/query-matching-users.ts`
- Create: `apps/worker/src/alerts/query-matching-users.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/worker/src/alerts/query-matching-users.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: { select: vi.fn() },
  };
});

const { db } = await import("@mn-platform/db");
const { queryMatchingUsers } = await import("./query-matching-users.js");

describe("queryMatchingUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] immediately when category is null (no DB call)", async () => {
    const result = await queryMatchingUsers(null);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns [] immediately when category is empty string (no DB call)", async () => {
    const result = await queryMatchingUsers("");
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries DB and returns matched user IDs", async () => {
    const mockWhere = vi.fn().mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const result = await queryMatchingUsers("IT");

    expect(db.select).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockInnerJoin).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(result).toEqual([{ userId: "user-1" }, { userId: "user-2" }]);
  });

  it("returns [] when no users match", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const result = await queryMatchingUsers("NonExistentCategory");

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect failures (function not found)**

```
pnpm --filter @mn-platform/worker run test -- src/alerts/query-matching-users.test.ts
```

Expected: FAIL — `queryMatchingUsers` is not defined.

- [ ] **Step 3: Implement `queryMatchingUsers`**

```typescript
// apps/worker/src/alerts/query-matching-users.ts
import { db, users, subscriptions, eq, and, sql } from "@mn-platform/db";

export interface MatchedUser {
  userId: string;
}

/**
 * Returns users whose active tender subscription includes the given category.
 * Returns [] immediately for null/empty category (no DB query).
 * Users with cardinality(categories) = 0 are excluded — they haven't chosen
 * categories yet and must opt in via the dashboard empty state.
 */
export async function queryMatchingUsers(category: string | null): Promise<MatchedUser[]> {
  if (!category) return [];

  return db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(subscriptions, sql`${subscriptions.orgId} = ${users.orgId}`)
    .where(
      and(
        eq(subscriptions.status, "active"),
        sql`'tender' = ANY(${subscriptions.modules})`,
        sql`cardinality(${subscriptions.categories}) > 0`,
        sql`${category} = ANY(${subscriptions.categories})`,
      ),
    );
}
```

- [ ] **Step 4: Run tests — expect all 4 to pass**

```
pnpm --filter @mn-platform/worker run test -- src/alerts/query-matching-users.test.ts
```

- [ ] **Step 5: Commit**

```
git add apps/worker/src/alerts/query-matching-users.ts apps/worker/src/alerts/query-matching-users.test.ts
git commit -m "feat(worker): queryMatchingUsers — fan-out query for tender alerts"
```

---

## Task 5: Wire tender alert fan-out in `scheduler.ts`

**Files:**
- Modify: `apps/worker/src/scheduler.ts`

- [ ] **Step 1: Update the tender `onChanged` in `registerJobs`**

The tender scrape job is in `registerJobs`. Replace the current inline `onChanged: (record) => notifyTenderChanged(record)` with an async handler that also fans out. `boss` is already in scope in `registerJobs`.

```typescript
// apps/worker/src/scheduler.ts
// Add import at top:
import { queryMatchingUsers } from "./alerts/query-matching-users.js";

// Inside registerJobs, replace the tender job's onChanged:
onChanged: async (record, _outcome, _previous, dbId) => {
  // Ops Telegram feed (best-effort — errors already swallowed inside)
  await notifyTenderChanged(record);

  // Customer alert fan-out — skip if no DB id or no category to match
  if (!dbId || !record.category) return;

  const hash = tenderSource.contentHash(record);
  let matches: { userId: string }[] = [];
  try {
    matches = await queryMatchingUsers(record.category);
  } catch (err) {
    logger.warn(
      { err, category: record.category, event: "query_matching_users_failed" },
      "alert fan-out aborted",
    );
    return;
  }

  for (const { userId } of matches) {
    await boss
      .send("alert.dispatch", { recordId: dbId, contentHash: hash, userId })
      .catch((err) =>
        logger.warn({ err, userId, event: "alert_enqueue_failed" }, "alert.dispatch enqueue failed"),
      );
  }
},
```

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```

Expected: clean. If `tenderSource.contentHash(record)` raises a type error, cast: `tenderSource.contentHash(record as Parameters<typeof tenderSource.contentHash>[0])` — but the source is typed `Source<unknown, TenderRecord>` so `contentHash` accepts `TenderRecord`. The `record` param of `onChanged` is `TenderRecord` here. Should be fine.

- [ ] **Step 3: Commit**

```
git add apps/worker/src/scheduler.ts
git commit -m "feat(worker): tender onChanged fans out alert.dispatch jobs per matching user"
```

---

## Task 6: Register `TelegramProvider` in `alert-dispatch.ts`

**Files:**
- Modify: `apps/worker/src/jobs/alert-dispatch.ts`

- [ ] **Step 1: Add `TelegramProvider` and register both providers**

```typescript
// apps/worker/src/jobs/alert-dispatch.ts
import PgBoss from "pg-boss";
import { Resend } from "resend";
import { z } from "zod";
import { dispatchAlert } from "../alerts/dispatch.js";
import { ResendEmailProvider } from "../alerts/providers/email.js";
import { TelegramProvider } from "../alerts/providers/telegram.js";
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

function createEmailProvider(): ResendEmailProvider {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from   = requireEnv("RESEND_FROM");
  return new ResendEmailProvider(new Resend(apiKey), from);
}

export const emailProvider = createEmailProvider();
export const telegramProvider = new TelegramProvider();

export function makeAlertDispatchHandler() {
  return async function handler(jobs: PgBoss.Job<unknown>[]) {
    const job = jobs[0];
    if (!job) return;
    const payload = AlertJobPayloadSchema.parse(job.data);
    await dispatchAlert(payload, [telegramProvider, emailProvider]);
    logger.info({ recordId: payload.recordId, userId: payload.userId }, "alert dispatched");
  };
}
```

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```

- [ ] **Step 3: Commit**

```
git add apps/worker/src/jobs/alert-dispatch.ts
git commit -m "feat(worker): register TelegramProvider in alert-dispatch handler"
```

---

## Task 7: Set default `alertChannels` in onboarding `saveModules`

**Files:**
- Modify: `apps/platform/src/app/onboarding/actions.ts`

- [ ] **Step 1: Update `saveModules` to set `alertChannels: ["telegram", "email"]`**

Find the `subscriptions.insert.values({...})` call inside `saveModules` and change `alertChannels: []` to `alertChannels: ["telegram", "email"]`:

```typescript
// apps/platform/src/app/onboarding/actions.ts — saveModules function
await db
  .insert(subscriptions)
  .values({
    orgId: session.user.orgId,
    modules: raw,
    categories: [],
    alertChannels: ["telegram", "email"],   // ← was []
    status: "trial",
  })
  .onConflictDoUpdate({
    target: subscriptions.orgId,
    set: { modules: raw, updatedAt: new Date() },
  });
```

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```

- [ ] **Step 3: Commit**

```
git add apps/platform/src/app/onboarding/actions.ts
git commit -m "feat(platform): new subscriptions default to telegram+email alert channels"
```

---

## Task 8: Dashboard — server action + `CategoryPicker` client component

**Files:**
- Create: `apps/platform/src/app/(dashboard)/dashboard/actions.ts`
- Create: `apps/platform/src/app/(dashboard)/dashboard/category-picker.tsx`

- [ ] **Step 1: Create `saveDashboardCategories` server action**

```typescript
// apps/platform/src/app/(dashboard)/dashboard/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db, subscriptions, eq } from "@mn-platform/db";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";

type ActionState = { error: string } | null;

export async function saveDashboardCategories(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.getAll("categories").filter((c): c is string => typeof c === "string");
  const validSet = new Set<string>(TENDER_CATEGORIES);
  const categories = raw.filter((c) => validSet.has(c));

  if (categories.length === 0) return { error: "Дор хаяж нэг ангилал сонго" };

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: ["tender"],
      categories,
      alertChannels: ["telegram", "email"],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { categories, updatedAt: new Date() },
    });

  revalidatePath("/dashboard");
  return null;
}
```

- [ ] **Step 2: Create `CategoryPicker` client component**

```tsx
// apps/platform/src/app/(dashboard)/dashboard/category-picker.tsx
"use client";

import { useState, useTransition } from "react";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";
import { saveDashboardCategories } from "./actions";

export function CategoryPicker() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (cat: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const handleSave = () => {
    const fd = new FormData();
    checked.forEach((c) => fd.append("categories", c));
    startTransition(async () => {
      const result = await saveDashboardCategories(null, fd);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-center gap-6 py-16 px-4 text-center">
      <h2 className="text-2xl font-semibold">Ангилал сонгоно уу</h2>
      <p className="text-gray-500 max-w-sm">
        Хянахыг хүссэн тендерийн ангиллуудаа сонгоно уу. Дараа нь тохирох тендерүүд энд харагдана.
      </p>
      <div className="flex flex-col gap-2 text-left w-full max-w-xs">
        {TENDER_CATEGORIES.map((cat) => (
          <label key={cat} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="accent-blue-600"
              checked={checked.has(cat)}
              onChange={() => toggle(cat)}
              disabled={isPending}
            />
            {cat}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending || checked.size === 0}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Хадгалж байна…" : "Хадгалах"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```
pnpm typecheck
```

- [ ] **Step 4: Commit**

```
git add apps/platform/src/app/(dashboard)/dashboard/actions.ts apps/platform/src/app/(dashboard)/dashboard/category-picker.tsx
git commit -m "feat(platform): dashboard category picker + saveDashboardCategories action"
```

---

## Task 9: Build the dashboard `page.tsx`

**Files:**
- Modify: `apps/platform/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Write the full dashboard page**

```tsx
// apps/platform/src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, tenders, subscriptions, eq, and, inArray, asc, sql } from "@mn-platform/db";
import { formatMnt } from "@mn-platform/mn";
import { CategoryPicker } from "./category-picker";

// ── Mongolian aimag list ────────────────────────────────────────────────────
const AIMAGS = [
  "Улаанбаатар",
  "Архангай", "Баян-Өлгий", "Баянхонгор", "Булган", "Говь-Алтай",
  "Говьсүмбэр", "Дархан-Уул", "Дорноговь", "Дорнод", "Дундговь",
  "Завхан", "Орхон", "Өвөрхангай", "Өмнөговь", "Сүхбаатар",
  "Сэлэнгэ", "Төв", "Увс", "Хентий", "Ховд", "Хөвсгөл",
] as const;

// ── Keyset cursor ───────────────────────────────────────────────────────────
interface Cursor {
  deadline: string | null; // ISO string or null
  id: string;              // UUID
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString()) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Status helpers ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  announced: "Зарлагдсан",
  open:      "Нээлттэй",
  closed:    "Хаагдсан",
  awarded:   "Шийдвэрлэсэн",
  cancelled: "Цуцлагдсан",
};

const STATUS_COLORS: Record<string, string> = {
  announced: "bg-blue-100 text-blue-800",
  open:      "bg-green-100 text-green-800",
  closed:    "bg-gray-100 text-gray-700",
  awarded:   "bg-teal-100 text-teal-800",
  cancelled: "bg-red-100 text-red-700",
};

// ── Page ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; aimag?: string; cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const statusParam = params.status === "open" || params.status === "closed" ? params.status : undefined;
  const aimagParam  = typeof params.aimag === "string" && params.aimag ? params.aimag : undefined;
  const cursor      = params.cursor ? decodeCursor(params.cursor) : null;

  // Load subscription for this org
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.orgId, session.user.orgId),
  });
  const userCategories = subscription?.categories ?? [];

  // ── Empty state: no categories chosen ─────────────────────────────────────
  if (userCategories.length === 0) {
    return (
      <main className="min-h-screen">
        <CategoryPicker />
      </main>
    );
  }

  // ── Build keyset cursor filter ─────────────────────────────────────────────
  const cursorFilter = cursor
    ? cursor.deadline === null
      ? sql`(${tenders.submissionDeadline} IS NULL AND ${tenders.id} > ${cursor.id}::uuid)`
      : sql`(
          ${tenders.submissionDeadline} > ${cursor.deadline}::timestamptz
          OR (
            ${tenders.submissionDeadline} = ${cursor.deadline}::timestamptz
            AND ${tenders.id} > ${cursor.id}::uuid
          )
          OR ${tenders.submissionDeadline} IS NULL
        )`
    : undefined;

  // ── Query tenders ──────────────────────────────────────────────────────────
  const rows = await db
    .select({
      id:                 tenders.id,
      tenderNo:           tenders.tenderNo,
      procuringEntity:    tenders.procuringEntity,
      estBudgetMnt:       tenders.estBudgetMnt,
      submissionDeadline: tenders.submissionDeadline,
      status:             tenders.status,
      aimag:              tenders.aimag,
    })
    .from(tenders)
    .where(
      and(
        inArray(tenders.category, userCategories),
        statusParam ? eq(tenders.status, statusParam) : undefined,
        aimagParam  ? eq(tenders.aimag, aimagParam)   : undefined,
        cursorFilter,
      ),
    )
    .orderBy(sql`${tenders.submissionDeadline} ASC NULLS LAST`, asc(tenders.id))
    .limit(PAGE_SIZE + 1);

  const hasNextPage = rows.length > PAGE_SIZE;
  const displayRows = hasNextPage ? rows.slice(0, PAGE_SIZE) : rows;
  const lastRow     = displayRows[displayRows.length - 1];
  const nextCursor  = hasNextPage && lastRow
    ? encodeCursor({
        deadline: lastRow.submissionDeadline?.toISOString() ?? null,
        id:       lastRow.id,
      })
    : null;

  // ── Build next-page URL preserving current filters ──────────────────────────
  function nextPageUrl(): string {
    const p = new URLSearchParams();
    if (statusParam) p.set("status", statusParam);
    if (aimagParam)  p.set("aimag", aimagParam);
    if (nextCursor)  p.set("cursor", nextCursor);
    const qs = p.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  }

  function filterUrl(overrides: Record<string, string | undefined>): string {
    const p = new URLSearchParams();
    const merged = { status: statusParam, aimag: aimagParam, ...overrides };
    if (merged.status) p.set("status", merged.status);
    if (merged.aimag)  p.set("aimag", merged.aimag);
    // Reset cursor on filter change
    const qs = p.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen px-4 py-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Тендер</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <a
          href={filterUrl({ status: undefined })}
          className={`px-3 py-1 rounded-full border ${!statusParam ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Бүгд
        </a>
        <a
          href={filterUrl({ status: "open" })}
          className={`px-3 py-1 rounded-full border ${statusParam === "open" ? "bg-green-600 text-white border-green-600" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Нээлттэй
        </a>
        <a
          href={filterUrl({ status: "closed" })}
          className={`px-3 py-1 rounded-full border ${statusParam === "closed" ? "bg-gray-600 text-white border-gray-600" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Хаагдсан
        </a>

        <form method="GET" action="/dashboard" className="flex items-center gap-2 ml-auto">
          {statusParam && <input type="hidden" name="status" value={statusParam} />}
          <select
            name="aimag"
            defaultValue={aimagParam ?? ""}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            aria-label="Аймаг/нийслэл шүүх"
          >
            <option value="">Бүх аймаг</option>
            {AIMAGS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button type="submit" className="px-3 py-1 bg-gray-900 text-white rounded text-sm">
            Шүүх
          </button>
          {aimagParam && (
            <a href={filterUrl({ aimag: undefined })} className="text-gray-500 hover:text-gray-800">
              ✕
            </a>
          )}
        </form>
      </div>

      {/* Tender table */}
      {displayRows.length === 0 ? (
        <div className="py-16 text-center text-gray-500">
          <p className="text-lg mb-2">Тохирох тендер олдсонгүй</p>
          <p className="text-sm">Шүүлтүүрийг өөрчилж үзнэ үү.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Дугаар</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Байгууллага</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Төсөв</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Дедлайн</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Төлөв</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {row.tenderNo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-900 max-w-xs truncate">
                    {row.procuringEntity ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                    {row.estBudgetMnt ? formatMnt(row.estBudgetMnt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {row.submissionDeadline
                      ? row.submissionDeadline.toLocaleDateString("mn-MN", {
                          timeZone: "Asia/Ulaanbaatar",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {nextCursor && (
        <div className="mt-4 text-right">
          <a
            href={nextPageUrl()}
            className="inline-block px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            Дараах →
          </a>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```

Expected: clean. If `inArray(tenders.category, userCategories)` raises a type error (nullable column vs string[]), replace with `sql\`${tenders.category} = ANY(${sql.array(userCategories, "text")})\``.

- [ ] **Step 3: Run all tests across monorepo**

```
pnpm -r run test
```

Expected: all 150+ tests pass (the 4 new query-matching-users tests + 2 new dispatch tests = ~152 total).

- [ ] **Step 4: Final typecheck**

```
pnpm typecheck
```

Expected: 5/5 packages clean.

- [ ] **Step 5: Commit**

```
git add apps/platform/src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat(platform): tender dashboard — table, filters, keyset pagination, empty state"
```

- [ ] **Step 6: Push branch**

```
git push
```

---

## Self-Review Checklist

- [x] **Spec: `queryMatchingUsers` with `cardinality > 0` guard** → Task 4
- [x] **Spec: category null → skip fan-out immediately** → Task 4 (returns `[]` for null/empty)
- [x] **Spec: channel resolution stays in `dispatch.ts`** → Task 6 (registers both providers; dispatch.ts gates unchanged)
- [x] **Spec: `onChanged` receives DB UUID** → Tasks 1 + 5
- [x] **Spec: `UpsertFn` return type change + all test updates** → Tasks 1 + 2
- [x] **Spec: `TelegramProvider` implemented** → Task 3
- [x] **Spec: `alertChannels` default set** → Task 7
- [x] **Spec: empty-state inline `CategoryPicker`** → Task 8
- [x] **Spec: dashboard table with columns + filters + keyset pagination** → Task 9
- [x] **Spec: `formatMnt` used for budget column** → Task 9 (imported from `@mn-platform/mn`)
- [x] **Spec: sorted by deadline ASC NULLS LAST** → Task 9 (`sql\`... ASC NULLS LAST\``)
- [x] **No placeholders or TBDs** — all code blocks are complete
- [x] **Type consistency** — `{ outcome: UpsertOutcome; id: string }` used throughout Tasks 1–2, `MatchedUser` used in Tasks 4–5, `Cursor` in Task 9
