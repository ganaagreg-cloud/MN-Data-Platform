# tender.gov.mn Source Adapters + TENDER_ADAPTER Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaffold Playwright adapter with a real one targeting `user.tender.gov.mn/mn/invitation`, scaffold a typed REST API stub for `opendata.tender.gov.mn`, add `fetched_via` provenance column to `tenders`, and gate adapter selection on a `TENDER_ADAPTER` env flag.

**Architecture:** Both adapters share a `TenderRecordSchema` and `tenderContentHash` from `tender-schema.ts`. The same `source_id = "tender.gov.mn"` is used for both — they form a fallback chain, never run simultaneously. `scheduler.ts` reads `TENDER_ADAPTER` at startup and registers exactly one adapter's job. `fetchedVia` is excluded from `contentHash` so switching adapters never triggers re-alerts.

**Tech Stack:** Playwright, drizzle-orm, Zod v4, packages/mn helpers (parseMnDate, parseMnt, normalizeText), Vitest.

**Execute after:** Plans 1 and 2 — this plan modifies `scheduler.ts` (created in Plan 1) and adds a migration that must come after the Plan 2 migration (0001).

---

## File Map

| Action | Path |
|---|---|
| Modify | `packages/core/src/types.ts` |
| Modify | `packages/db/src/schema/index.ts` |
| Generate | `packages/db/migrations/0002_*.sql` |
| Create | `apps/worker/src/sources/tender-schema.ts` |
| Replace | `apps/worker/src/sources/tender-gov-mn.ts` |
| Create | `apps/worker/src/sources/opendata-tender-gov-mn.ts` |
| Modify | `apps/worker/src/db-adapter.ts` |
| Modify | `apps/worker/src/scheduler.ts` |
| Create | `apps/worker/src/sources/tender-schema.test.ts` |
| Create | `apps/worker/src/sources/opendata-tender-gov-mn.test.ts` |

---

### Task 1: Add `fetched_via` to DB schema + migration

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Generate: `packages/db/migrations/0002_*.sql`

- [ ] **Step 1: Add fetchedVia to tenders table in packages/db/src/schema/index.ts**

Inside the `tenders` `pgTable(...)` definition, add after the `status` field (before `...timestamps`):

```ts
fetchedVia: text("fetched_via"),
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:generate
```

Expected: `packages/db/migrations/0002_*.sql` created containing:

```sql
ALTER TABLE "tenders" ADD COLUMN "fetched_via" text;
```

- [ ] **Step 3: Apply migration**

```bash
pnpm db:migrate
```

Expected: exits 0, `fetched_via` column now exists in the `tenders` table.

- [ ] **Step 4: Typecheck db package**

```bash
cd packages/db && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(db): add tenders.fetched_via provenance column"
```

---

### Task 2: Add `fetchedVia` to `TenderRecord` core type

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add fetchedVia to TenderRecord in packages/core/src/types.ts**

Add the field after `status`:

```ts
/**
 * Which adapter wrote this record ("playwright" | "api" | future).
 * Excluded from contentHash — switching adapters must not trigger re-alerts.
 */
fetchedVia: string;
```

The full updated `TenderRecord` interface:

```ts
export interface TenderRecord {
  externalId: string;
  tenderNo: string | null;
  procuringEntity: string | null;
  category: string | null;
  /** numeric(18,2) as a string — never a JS number */
  estBudgetMnt: string | null;
  announceDate: Date | null;
  submissionDeadline: Date | null;
  /** numeric(18,2) as a string — never a JS number */
  bidSecurityMnt: string | null;
  aimag: string | null;
  status: string;
  /**
   * Which adapter wrote this record ("playwright" | "api" | future).
   * Excluded from contentHash — switching adapters must not trigger re-alerts.
   */
  fetchedVia: string;
  raw: Record<string, unknown>;
}
```

- [ ] **Step 2: Typecheck core**

```bash
cd packages/core && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Typecheck worker (the existing scaffold adapter now fails)**

```bash
cd apps/worker && pnpm typecheck
```

Expected: **TypeScript errors** on `apps/worker/src/sources/tender-gov-mn.ts` — the old scaffold's `parse()` does not return `fetchedVia`. This is expected and will be fixed when the scaffold is replaced in Task 4.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add fetchedVia field to TenderRecord"
```

---

### Task 3: `tender-schema.ts` — shared Zod schema + contentHash

**Files:**
- Create: `apps/worker/src/sources/tender-schema.ts`
- Create: `apps/worker/src/sources/tender-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/sources/tender-schema.test.ts
import { describe, it, expect } from "vitest";
import { tenderContentHash, TenderRecordSchema } from "./tender-schema.js";
import type { TenderRecord } from "@mn-platform/core";

const base: TenderRecord = {
  externalId:         "TD-001",
  tenderNo:           "ТД-2026-001",
  procuringEntity:    "Монгол улс",
  category:           "Барилга",
  estBudgetMnt:       "1000000.00",
  announceDate:       new Date("2026-06-01T00:00:00Z"),
  submissionDeadline: new Date("2026-07-01T00:00:00Z"),
  bidSecurityMnt:     "50000.00",
  aimag:              "УБ",
  status:             "announced",
  fetchedVia:         "playwright",
  raw:                {},
};

describe("tenderContentHash", () => {
  it("is deterministic for the same input", () => {
    expect(tenderContentHash(base)).toBe(tenderContentHash(base));
  });

  it("changes when status changes", () => {
    const modified = { ...base, status: "closed" };
    expect(tenderContentHash(base)).not.toBe(tenderContentHash(modified));
  });

  it("is identical regardless of fetchedVia value", () => {
    const playwright = { ...base, fetchedVia: "playwright" };
    const api        = { ...base, fetchedVia: "api" };
    expect(tenderContentHash(playwright)).toBe(tenderContentHash(api));
  });
});

describe("TenderRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(() => TenderRecordSchema.parse(base)).not.toThrow();
  });

  it("rejects a record with empty externalId", () => {
    expect(() => TenderRecordSchema.parse({ ...base, externalId: "" })).toThrow();
  });

  it("accepts null nullable fields", () => {
    const minimal = {
      ...base,
      tenderNo: null, procuringEntity: null, category: null,
      estBudgetMnt: null, announceDate: null, submissionDeadline: null,
      bidSecurityMnt: null, aimag: null,
    };
    expect(() => TenderRecordSchema.parse(minimal)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `tender-schema.js` not found.

- [ ] **Step 3: Implement tender-schema.ts**

```ts
// apps/worker/src/sources/tender-schema.ts
import { z } from "zod";
import { sha256 } from "@mn-platform/core";
import type { TenderRecord } from "@mn-platform/core";

export const TenderRecordSchema = z.object({
  externalId:         z.string().min(1),
  tenderNo:           z.string().nullable(),
  procuringEntity:    z.string().nullable(),
  category:           z.string().nullable(),
  estBudgetMnt:       z.string().nullable(),
  announceDate:       z.date().nullable(),
  submissionDeadline: z.date().nullable(),
  bidSecurityMnt:     z.string().nullable(),
  aimag:              z.string().nullable(),
  status:             z.string(),
  fetchedVia:         z.string(),
  raw:                z.record(z.string(), z.unknown()),
});

/**
 * Hash only canonical business fields.
 * fetchedVia is intentionally excluded: switching adapters must not re-alert users.
 * Scrape timestamps must never appear here.
 */
export function tenderContentHash(r: TenderRecord): string {
  return sha256(
    [
      r.tenderNo            ?? "",
      r.procuringEntity     ?? "",
      r.submissionDeadline?.toISOString() ?? "",
      r.estBudgetMnt        ?? "",
      r.status,
    ].join("|"),
  );
}
```

- [ ] **Step 4: Run test — verify all pass**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/sources/tender-schema.ts apps/worker/src/sources/tender-schema.test.ts
git commit -m "feat(worker): add shared TenderRecordSchema + tenderContentHash"
```

---

### Task 4: Replace scaffold with Playwright adapter (`tender-gov-mn.ts`)

**Files:**
- Replace: `apps/worker/src/sources/tender-gov-mn.ts`

This replaces the old scaffold (which targeted `tender.gov.mn/mn/tender/list` with un-inspected selectors).

> **Compliance:** Before the first live run, verify `user.tender.gov.mn` robots.txt:
> ```bash
> curl https://user.tender.gov.mn/robots.txt
> ```
> Confirm `/mn/invitation` is not disallowed. The old `tender.gov.mn` check does not cover this subdomain.

- [ ] **Step 1: Replace apps/worker/src/sources/tender-gov-mn.ts**

```ts
// apps/worker/src/sources/tender-gov-mn.ts
//
// Source adapter — user.tender.gov.mn/mn/invitation (public listing page, no auth).
//
// robots.txt: MUST verify https://user.tender.gov.mn/robots.txt before first live run.
// Rendering: JS — Playwright + Chromium.
// Rate limit: getRateLimiter("user.tender.gov.mn") — 1 req / 2 s ± 500 ms (subdomain-scoped).
// User-Agent: honest (TenderAlert/1.0). No spoofing, no rotation.

import { chromium } from "playwright";
import { getRateLimiter } from "@mn-platform/core";
import { normalizeText, parseMnDate, parseMnt } from "@mn-platform/mn";
import type { Source, TenderRecord } from "@mn-platform/core";
import { TenderRecordSchema, tenderContentHash } from "./tender-schema.js";

// ── raw shape scraped from the DOM ───────────────────────────────────────────

interface RawTender {
  tenderNo: string;
  title: string;
  procuringEntity: string;
  category: string;
  estBudgetMnt: string;
  submissionDeadline: string;
  announceDate: string;
  bidSecurityMnt: string;
  aimag: string;
  status: string;
  /** Trailing path segment used as externalId fallback when tenderNo is absent. */
  detailPath: string;
}

// ── constants ────────────────────────────────────────────────────────────────

const SOURCE_ID  = "tender.gov.mn";
const LIST_URL   = "https://user.tender.gov.mn/mn/invitation";
const USER_AGENT = "TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)";

// Rate limiter keyed on the subdomain being hit (not source_id).
const limiter = getRateLimiter("user.tender.gov.mn");

/**
 * DOM selectors — update this block after a single browser-devtools session on
 * https://user.tender.gov.mn/mn/invitation. All TODOs are co-located here so
 * one inspect pass wires the adapter completely.
 */
const SEL = {
  ROW:         "table tbody tr",                        // TODO: verify after live inspect
  TENDER_NO:   "td:nth-child(1)",                       // TODO: adjust column indices
  TITLE:       "td:nth-child(2)",
  ENTITY:      "td:nth-child(3)",
  CATEGORY:    "td:nth-child(4)",
  BUDGET:      "td:nth-child(5)",
  DEADLINE:    "td:nth-child(6)",
  ANNOUNCE:    "td:nth-child(7)",
  BID_SEC:     "td:nth-child(8)",
  AIMAG:       "td:nth-child(9)",
  STATUS:      "td:nth-child(10)",
  DETAIL_LINK: "a[href]",
  NEXT_PAGE:   ".pagination .next:not(.disabled)",      // TODO: verify pagination pattern
} as const;

// ── DOM extraction (runs inside browser via $$eval) ──────────────────────────
// Must be a self-contained function — no outer-scope references.
// Playwright serialises this function body into the page context.
// Column indices match SEL.TENDER_NO etc; update both together after inspect.

function extractRows(els: Element[]): RawTender[] {
  return els.map((el) => {
    const cell = (n: number) =>
      el.querySelector(`td:nth-child(${n})`)?.textContent?.trim() ?? "";
    const link = el.querySelector("a[href]");

    return {
      tenderNo:           cell(1),   // TODO: adjust after live inspect
      title:              cell(2),
      procuringEntity:    cell(3),
      category:           cell(4),
      estBudgetMnt:       cell(5),
      submissionDeadline: cell(6),
      announceDate:       cell(7),
      bidSecurityMnt:     cell(8),
      aimag:              cell(9),
      status:             cell(10),
      detailPath:         link?.getAttribute("href") ?? "",
    };
  });
}

// ── source implementation ────────────────────────────────────────────────────

export const tenderGovMnSource: Source<RawTender, TenderRecord> = {
  id: SOURCE_ID,

  async fetchPage(cursor) {
    const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;

    await limiter.acquire();

    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent:  USER_AGENT,
        locale:     "mn-MN",
        timezoneId: "Asia/Ulaanbaatar",
        viewport:   { width: 1280, height: 800 },
        extraHTTPHeaders: {
          "Accept-Language": "mn-MN,mn;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
      const page = await ctx.newPage();

      await page.goto(`${LIST_URL}?page=${pageNum}`, {
        waitUntil: "networkidle",
        timeout:   30_000,
      });

      await page.waitForSelector(SEL.ROW, { timeout: 15_000 });

      // Randomised post-load delay — reduces burst pressure; allows lazy content to settle.
      await page.waitForTimeout(1_000 + Math.random() * 2_000);

      // extractRows is passed directly — it is serialised into the page context by
      // Playwright. It must remain self-contained (no outer-scope references).
      const raw = await page.$$eval(SEL.ROW, extractRows);

      const hasNext = (await page.$(SEL.NEXT_PAGE)) !== null;

      return {
        raw,
        ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}),
      };
    } finally {
      await browser.close();
    }
  },

  parse(raw) {
    const tenderNo = raw.tenderNo ? normalizeText(raw.tenderNo) : null;
    const detailSlug =
      raw.detailPath.split("/").filter(Boolean).pop() ?? "";
    const externalId = tenderNo ?? detailSlug;

    if (!externalId) {
      throw new Error(
        `tender.gov.mn: cannot derive externalId — tenderNo empty and no detailPath. Row: ${JSON.stringify(raw)}`,
      );
    }

    return {
      externalId,
      tenderNo,
      procuringEntity:    raw.procuringEntity ? normalizeText(raw.procuringEntity) : null,
      category:           raw.category ? normalizeText(raw.category) : null,
      estBudgetMnt:       raw.estBudgetMnt ? parseMnt(raw.estBudgetMnt) : null,
      announceDate:       raw.announceDate ? parseMnDate(raw.announceDate) : null,
      submissionDeadline: raw.submissionDeadline ? parseMnDate(raw.submissionDeadline) : null,
      bidSecurityMnt:     raw.bidSecurityMnt ? parseMnt(raw.bidSecurityMnt) : null,
      aimag:              raw.aimag ? normalizeText(raw.aimag) : null,
      status:             raw.status ? normalizeText(raw.status) : "announced",
      fetchedVia:         "playwright",
      raw:                raw as unknown as Record<string, unknown>,
    };
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0 — the scaffold's type errors are resolved.

- [ ] **Step 3: Run tests**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/sources/tender-gov-mn.ts
git commit -m "feat(worker): replace scaffold with Playwright adapter for user.tender.gov.mn/mn/invitation"
```

---

### Task 5: OpenData API stub (`opendata-tender-gov-mn.ts`)

**Files:**
- Create: `apps/worker/src/sources/opendata-tender-gov-mn.ts`
- Create: `apps/worker/src/sources/opendata-tender-gov-mn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/sources/opendata-tender-gov-mn.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDataTenderSource } from "./opendata-tender-gov-mn.js";

describe("openDataTenderSource", () => {
  const originalToken = process.env["OPENDATA_BEARER_TOKEN"];

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["OPENDATA_BEARER_TOKEN"];
    } else {
      process.env["OPENDATA_BEARER_TOKEN"] = originalToken;
    }
  });

  it("has source_id tender.gov.mn", () => {
    expect(openDataTenderSource.id).toBe("tender.gov.mn");
  });

  it("throws a clear error when OPENDATA_BEARER_TOKEN is not set", async () => {
    delete process.env["OPENDATA_BEARER_TOKEN"];
    await expect(openDataTenderSource.fetchPage()).rejects.toThrow(
      "OPENDATA_BEARER_TOKEN",
    );
  });

  it("throws not-implemented when token is set (stub)", async () => {
    process.env["OPENDATA_BEARER_TOKEN"] = "test-token";
    await expect(openDataTenderSource.fetchPage()).rejects.toThrow(
      "not yet implemented",
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `opendata-tender-gov-mn.js` not found.

- [ ] **Step 3: Implement opendata-tender-gov-mn.ts**

```ts
// apps/worker/src/sources/opendata-tender-gov-mn.ts
//
// Stub adapter for opendata.tender.gov.mn REST API (Bearer token, POST).
// Same source_id as the Playwright adapter — they form a fallback chain;
// only one runs at a time, selected by TENDER_ADAPTER env var.
//
// Wire this in when:
//   1. OPENDATA_BEARER_TOKEN is available
//   2. API response shape is documented
//
// TODO before implementing fetchPage:
//   - Verify https://opendata.tender.gov.mn/robots.txt
//   - Add getRateLimiter("opendata.tender.gov.mn").acquire() before the fetch call
//   - Map the POST response envelope to { raw: RawApiTender[], nextCursor? }
//
// TODO before implementing parse:
//   - Map API JSON fields to TenderRecord using @mn-platform/mn helpers
//   - Set fetchedVia: "api"

import type { Source, TenderRecord } from "@mn-platform/core";
import { TenderRecordSchema, tenderContentHash } from "./tender-schema.js";

const SOURCE_ID = "tender.gov.mn";
// BASE_URL used when fetchPage is implemented
const _BASE_URL = "https://opendata.tender.gov.mn";

interface RawApiTender extends Record<string, unknown> {}

export const openDataTenderSource: Source<RawApiTender, TenderRecord> = {
  id: SOURCE_ID,

  async fetchPage(_cursor?: string): Promise<{ raw: RawApiTender[]; nextCursor?: string }> {
    const token = process.env["OPENDATA_BEARER_TOKEN"];
    if (!token) {
      throw new Error(
        "opendata.tender.gov.mn: OPENDATA_BEARER_TOKEN env var not set — adapter cannot run",
      );
    }
    throw new Error(
      "opendata.tender.gov.mn: fetchPage not yet implemented — waiting for API docs",
    );
  },

  parse(_raw: RawApiTender): TenderRecord {
    throw new Error(
      "opendata.tender.gov.mn: parse not yet implemented — waiting for API docs",
    );
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
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
git add apps/worker/src/sources/opendata-tender-gov-mn.ts apps/worker/src/sources/opendata-tender-gov-mn.test.ts
git commit -m "feat(worker): scaffold opendata.tender.gov.mn stub adapter with clear error messages"
```

---

### Task 6: `TENDER_ADAPTER` flag in `scheduler.ts`

**Files:**
- Modify: `apps/worker/src/scheduler.ts`

- [ ] **Step 1: Update scheduler.ts**

Replace the `scrape.tender-gov-mn` block in `registerJobs` with the adapter-aware version.

Add imports at the top of `scheduler.ts`:

```ts
import { tenderGovMnSource } from "./sources/tender-gov-mn.js";
import { openDataTenderSource } from "./sources/opendata-tender-gov-mn.js";
```

Add the `resolveTenderAdapter` function (before `registerJobs`):

```ts
type TenderAdapter = "playwright" | "api";

function resolveTenderAdapter(): TenderAdapter {
  const raw = process.env["TENDER_ADAPTER"] ?? "playwright";
  if (raw !== "playwright" && raw !== "api") {
    throw new Error(
      `TENDER_ADAPTER must be "playwright" or "api", got "${raw}"`,
    );
  }
  return raw;
}
```

Replace the `scrape.tender-gov-mn` section inside `registerJobs`:

```ts
// ── scrape.tender-gov-mn ────────────────────────────────────────────────────
// Validate at startup, not at first job tick.
const adapter = resolveTenderAdapter();
const tenderSource = adapter === "playwright" ? tenderGovMnSource : openDataTenderSource;

await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", null, {
  tz: "Asia/Ulaanbaatar",
});

await boss.work(
  "scrape.tender-gov-mn",
  { localConcurrency: 2 },
  async ([_job]) => {
    const result = await runPipeline(tenderSource, db);
    state.lastRunAt = new Date();
    logger.info({ ...result, adapter, event: "scrape_complete" });
  },
);
```

- [ ] **Step 2: Remove the now-redundant tenderGovMnSource import**

The old scheduler.ts already imported `tenderGovMnSource`. The new version imports both — confirm there is no duplicate import line.

- [ ] **Step 3: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scheduler.ts
git commit -m "feat(worker): add TENDER_ADAPTER env flag — selects playwright or api adapter at startup"
```

---

### Task 7: Update `db-adapter.ts` to write `fetched_via`

**Files:**
- Modify: `apps/worker/src/db-adapter.ts`

- [ ] **Step 1: Add fetchedVia to both insert and update paths in db-adapter.ts**

In the `if (existing.length === 0)` branch, add `fetchedVia: record.fetchedVia` to the `.values({...})` call:

```ts
await db.insert(tenders).values({
  sourceId,
  externalId:          record.externalId,
  contentHash,
  firstSeenAt:         now,
  lastSeenAt:          now,
  tenderNo:            record.tenderNo,
  procuringEntity:     record.procuringEntity,
  category:            record.category,
  estBudgetMnt:        record.estBudgetMnt,
  announceDate:        record.announceDate,
  submissionDeadline:  record.submissionDeadline,
  bidSecurityMnt:      record.bidSecurityMnt,
  aimag:               record.aimag,
  status:              record.status,
  fetchedVia:          record.fetchedVia,
  raw:                 record.raw,
});
```

In the hash-changed update branch, add `fetchedVia: record.fetchedVia` to the `.set({...})` call:

```ts
await db
  .update(tenders)
  .set({
    contentHash,
    lastSeenAt:          now,
    tenderNo:            record.tenderNo,
    procuringEntity:     record.procuringEntity,
    category:            record.category,
    estBudgetMnt:        record.estBudgetMnt,
    announceDate:        record.announceDate,
    submissionDeadline:  record.submissionDeadline,
    bidSecurityMnt:      record.bidSecurityMnt,
    aimag:               record.aimag,
    status:              record.status,
    fetchedVia:          record.fetchedVia,
    raw:                 record.raw,
  })
  .where(eq(tenders.id, row.id));
```

The `"unchanged"` branch (only updates `lastSeenAt`) is left untouched — `fetched_via` is not overwritten for unchanged records, preserving the adapter that last made a content change.

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
git add apps/worker/src/db-adapter.ts
git commit -m "feat(worker): write fetched_via provenance in tenders upsert"
```

---

### Task 8: Final typecheck + lint

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

- [ ] **Step 4: Verify TENDER_ADAPTER validation**

```bash
TENDER_ADAPTER=invalid node -e "
import('./apps/worker/dist/scheduler.js').then(m => m.resolveTenderAdapter()).catch(e => { console.log(e.message); process.exit(0); })
"
```

Expected output contains: `TENDER_ADAPTER must be "playwright" or "api"`.

(Run after `pnpm build` if dist/ not yet populated.)

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore(worker): apply lint fixes — source adapters"
```
