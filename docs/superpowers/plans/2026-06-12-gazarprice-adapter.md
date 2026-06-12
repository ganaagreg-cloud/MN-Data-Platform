# GazarPrice Adapter (unegui.mn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape UB apartment sale and rent listings from unegui.mn into a shared `listings` table, computing `price_per_m²` for aggregate analytics, with a generic `filter?` method on `Source` and a separate `runListingPipeline` alongside the existing tender pipeline.

**Architecture:** `ListingRecord` and `PipelineResult` (renamed from `RunResult`) are added to `packages/core/src/types.ts`. A new `runListingPipeline` mirrors `runPipeline` but calls `db.upsertListing`. One `unegui-mn.ts` exports both `uneguiSaleSource` and `uneguiRentSource` — shared parse logic, different URLs and `listingType` values. `filter: (r) => r.district !== null` on both sources enforces UB-only scope. `createDbAdapter()` gains `upsertListing` alongside `upsertTender`. Two new pg-boss jobs (`scrape.unegui-sale` at 01:00, `scrape.unegui-rent` at 03:00 UB time) with Sentry try/catch applied to all three scrape handlers.

**Tech Stack:** Playwright, Drizzle ORM, Zod v4, `@mn-platform/mn` helpers (parseMnt, normalizeDistrict, normalizeText), Vitest, `@sentry/node`.

**Execute after:** Plans 1, 2, and 3 — this plan modifies `scheduler.ts`, `db-adapter.ts`, and `packages/core` which are all live from prior plans.

---

## File Map

| Action | Path |
|---|---|
| Modify | `packages/core/src/types.ts` |
| Modify | `packages/core/src/pipeline.ts` |
| Modify | `packages/core/src/index.ts` |
| Create | `packages/core/src/listing-pipeline.ts` |
| Modify | `packages/db/src/schema/index.ts` |
| Generate | `packages/db/migrations/0003_*.sql` |
| Create | `apps/worker/src/sources/listing-schema.ts` |
| Create | `apps/worker/src/sources/listing-schema.test.ts` |
| Create | `apps/worker/src/sources/unegui-mn.ts` |
| Create | `apps/worker/src/sources/unegui-mn.test.ts` |
| Create | `apps/worker/src/listing-pipeline.test.ts` |
| Modify | `apps/worker/src/db-adapter.ts` |
| Modify | `apps/worker/src/scheduler.ts` |

---

### Task 1: Core type changes

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace packages/core/src/types.ts**

```ts
// packages/core/src/types.ts
import type { ZodSchema } from "zod";

export type UpsertOutcome = "created" | "updated" | "unchanged";

export interface Source<TRaw, TRecord> {
  readonly id: string;
  fetchPage(cursor?: string): Promise<{ raw: TRaw[]; nextCursor?: string }>;
  parse(raw: TRaw): TRecord;
  schema: ZodSchema<TRecord>;
  contentHash(record: TRecord): string;
  /** Optional. Records where this returns false are skipped — not upserted, not alerted. */
  filter?(record: TRecord): boolean;
}

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

export interface ListingRecord {
  externalId: string;
  listingType: "sale" | "rent";
  district: string | null;     // normalizeDistrict() output — null means outside UB
  khoroo: string | null;
  rooms: number | null;
  areaM2: number | null;       // stored as number; toFixed(2) only in upsertListing
  floor: number | null;
  building: string | null;
  priceMnt: number | null;     // sale price or monthly rent; toFixed(2) only in upsertListing
  pricePerM2: number | null;   // derived: priceMnt / areaM2; null if either null or areaM2 === 0
  raw: Record<string, unknown>;
}

/** Returned by both runPipeline and runListingPipeline. */
export interface PipelineResult {
  source: string;
  fetched: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}
```

- [ ] **Step 2: Replace packages/core/src/pipeline.ts**

`UpsertOutcome` is now imported from `./types.js`. `RunResult` is replaced with `PipelineResult`. Add `skipped` counter and `filter` support.

```ts
// packages/core/src/pipeline.ts
import type { Source, PipelineResult, TenderRecord, UpsertOutcome } from "./types.js";

export interface PipelineDb {
  upsertTender(
    sourceId: string,
    contentHash: string,
    record: TenderRecord,
  ): Promise<UpsertOutcome>;
}

export async function runPipeline<TRaw, TRecord extends TenderRecord>(
  source: Source<TRaw, TRecord>,
  db: PipelineDb,
): Promise<PipelineResult> {
  const start = Date.now();
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined;

  do {
    const { raw, nextCursor } = await source.fetchPage(cursor);
    fetched += raw.length;

    for (const rawRow of raw) {
      try {
        const record = source.parse(rawRow);
        const validated = source.schema.parse(record) as TRecord;

        if (source.filter && !source.filter(validated)) {
          skipped++;
          continue;
        }

        const hash = source.contentHash(validated);
        const outcome = await db.upsertTender(source.id, hash, validated);
        if (outcome === "created") created++;
        else if (outcome === "updated") updated++;
      } catch (err) {
        errors++;
        console.error(
          JSON.stringify({
            source: source.id,
            event: "row_error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    cursor = nextCursor;
  } while (cursor !== undefined);

  return {
    source: source.id,
    fetched,
    new: created,
    updated,
    skipped,
    errors,
    durationMs: Date.now() - start,
  };
}
```

- [ ] **Step 3: Replace packages/core/src/index.ts**

`UpsertOutcome` moves to types.js. `RunResult` → `PipelineResult`. `ListingRecord` added.

```ts
// packages/core/src/index.ts
export type { Source, TenderRecord, ListingRecord, PipelineResult, UpsertOutcome } from "./types.js";
export { runPipeline } from "./pipeline.js";
export type { PipelineDb } from "./pipeline.js";
export { sha256 } from "./hash.js";
export { RateLimiter, getRateLimiter } from "./rate-limiter.js";
```

Note: `runListingPipeline` and `ListingPipelineDb` are added in Task 2 once the file exists.

- [ ] **Step 4: Typecheck core**

```bash
cd D:\files\mn-data-platform\packages\core && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/pipeline.ts packages/core/src/index.ts
git commit -m "feat(core): add ListingRecord, PipelineResult, filter? — shared pipeline types"
```

---

### Task 2: `runListingPipeline` + `ListingPipelineDb` (TDD)

**Files:**
- Create: `packages/core/src/listing-pipeline.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/listing-pipeline.test.ts`:

```ts
// packages/core/src/listing-pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runListingPipeline } from "./listing-pipeline.js";
import type { ListingPipelineDb } from "./listing-pipeline.js";
import type { Source, ListingRecord } from "./types.js";
import { z } from "zod";

const record: ListingRecord = {
  externalId:  "L-001",
  listingType: "sale",
  district:    "БЗД",
  khoroo:      null,
  rooms:       2,
  areaM2:      50,
  floor:       3,
  building:    null,
  priceMnt:    100_000_000,
  pricePerM2:  2_000_000,
  raw:         {},
};

const schema = z.object({
  externalId: z.string(), listingType: z.enum(["sale", "rent"]),
  district: z.string().nullable(), khoroo: z.string().nullable(),
  rooms: z.number().nullable(), areaM2: z.number().nullable(),
  floor: z.number().nullable(), building: z.string().nullable(),
  priceMnt: z.number().nullable(), pricePerM2: z.number().nullable(),
  raw: z.record(z.string(), z.unknown()),
});

describe("runListingPipeline", () => {
  it("upserts a record and returns new=1", async () => {
    const upsertListing = vi.fn().mockResolvedValue("created");
    const db: ListingPipelineDb = { upsertListing };
    const source: Source<ListingRecord, ListingRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runListingPipeline(source, db);

    expect(upsertListing).toHaveBeenCalledOnce();
    expect(result.new).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.fetched).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("skips records where source.filter returns false", async () => {
    const upsertListing = vi.fn().mockResolvedValue("created");
    const db: ListingPipelineDb = { upsertListing };
    const source: Source<ListingRecord, ListingRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [{ ...record, district: null }] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: (r) => r.district !== null,
    };

    const result = await runListingPipeline(source, db);

    expect(upsertListing).not.toHaveBeenCalled();
    expect(result.new).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd D:\files\mn-data-platform\packages\core && pnpm test
```

Expected: FAIL — `./listing-pipeline.js` not found.

- [ ] **Step 3: Create packages/core/src/listing-pipeline.ts**

```ts
// packages/core/src/listing-pipeline.ts
import type { Source, ListingRecord, PipelineResult, UpsertOutcome } from "./types.js";

export interface ListingPipelineDb {
  upsertListing(
    sourceId: string,
    contentHash: string,
    record: ListingRecord,
  ): Promise<UpsertOutcome>;
}

export async function runListingPipeline<TRaw>(
  source: Source<TRaw, ListingRecord>,
  db: ListingPipelineDb,
): Promise<PipelineResult> {
  const start = Date.now();
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined;

  do {
    const { raw, nextCursor } = await source.fetchPage(cursor);
    fetched += raw.length;

    for (const rawRow of raw) {
      try {
        const record = source.parse(rawRow);
        const validated = source.schema.parse(record);

        if (source.filter && !source.filter(validated)) {
          skipped++;
          continue;
        }

        const hash = source.contentHash(validated);
        const outcome = await db.upsertListing(source.id, hash, validated);
        if (outcome === "created") created++;
        else if (outcome === "updated") updated++;
      } catch (err) {
        errors++;
        console.error(
          JSON.stringify({
            source: source.id,
            event: "row_error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    cursor = nextCursor;
  } while (cursor !== undefined);

  return {
    source: source.id,
    fetched,
    new: created,
    updated,
    skipped,
    errors,
    durationMs: Date.now() - start,
  };
}
```

- [ ] **Step 4: Add vitest config to packages/core if missing**

Check whether `packages/core/package.json` has a test script. If not, add:

```json
"test": "vitest run"
```

Also add `vitest` to devDependencies if missing:

```bash
cd D:\files\mn-data-platform\packages\core && pnpm add -D vitest
```

- [ ] **Step 5: Run test — verify both pass**

```bash
cd D:\files\mn-data-platform\packages\core && pnpm test
```

Expected: 2 tests pass.

- [ ] **Step 6: Update packages/core/src/index.ts — add listing-pipeline exports**

```ts
// packages/core/src/index.ts
export type { Source, TenderRecord, ListingRecord, PipelineResult, UpsertOutcome } from "./types.js";
export { runPipeline } from "./pipeline.js";
export type { PipelineDb } from "./pipeline.js";
export { runListingPipeline } from "./listing-pipeline.js";
export type { ListingPipelineDb } from "./listing-pipeline.js";
export { sha256 } from "./hash.js";
export { RateLimiter, getRateLimiter } from "./rate-limiter.js";
```

- [ ] **Step 7: Typecheck core**

```bash
cd D:\files\mn-data-platform\packages\core && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/listing-pipeline.ts packages/core/src/listing-pipeline.test.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): add runListingPipeline with filter support"
```

---

### Task 3: DB schema + migration

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Generate: `packages/db/migrations/0003_*.sql`

- [ ] **Step 1: Add listingType to listings table in packages/db/src/schema/index.ts**

Find the `listings` table definition. Add `listingType` as the first field after `raw`, and add the composite index. Replace the listings table definition with:

```ts
// ── listings ──────────────────────────────────────────────────────────────────
// district enum: БЗД | СБД | ЧД | ХУД | СХД | БГД | Налайх | Багануур | Багахангай
// pricePerM2 is derived — stored for fast aggregate queries, never republished
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw").notNull(),
    listingType: text("listing_type", { enum: ["sale", "rent"] }).notNull(),
    district: text("district"),
    khoroo: text("khoroo"),
    rooms: integer("rooms"),
    areaM2: numeric("area_m2", { precision: 8, scale: 2 }),
    floor: integer("floor"),
    building: text("building"),
    priceMnt: numeric("price_mnt", { precision: 18, scale: 2 }),
    pricePerM2: numeric("price_per_m2", { precision: 18, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listings_source_external_idx").on(t.sourceId, t.externalId),
    index("listings_district_idx").on(t.district),
    index("listings_price_per_m2_idx").on(t.pricePerM2),
    index("listings_created_at_idx").on(t.createdAt),
    index("listings_type_district_idx").on(t.listingType, t.district),
  ],
);
```

- [ ] **Step 2: Generate migration**

```bash
cd D:\files\mn-data-platform && pnpm db:generate
```

Expected: `packages/db/migrations/0003_*.sql` created.

- [ ] **Step 3: Verify migration SQL**

Open the generated `0003_*.sql` and confirm it contains:

```sql
ALTER TABLE "listings" ADD COLUMN "listing_type" text NOT NULL;
```

And a CREATE INDEX for `listings_type_district_idx`. If the migration looks correct, continue. If Drizzle generated something unexpected, check the schema change.

**Note:** Drizzle's `text(..., { enum: [...] })` adds a TypeScript-level constraint but may not generate a SQL CHECK constraint automatically. If the generated SQL lacks `CHECK (listing_type IN ('sale', 'rent'))`, manually edit the migration file to add it inline:

```sql
ALTER TABLE "listings" ADD COLUMN "listing_type" text NOT NULL CHECK (listing_type IN ('sale', 'rent'));
```

- [ ] **Step 4: Typecheck db**

```bash
cd D:\files\mn-data-platform\packages\db && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(db): add listings.listing_type column with NOT NULL + CHECK constraint"
```

---

### Task 4: `listing-schema.ts` (TDD) + filter integration test

**Files:**
- Create: `apps/worker/src/sources/listing-schema.test.ts`
- Create: `apps/worker/src/sources/listing-schema.ts`
- Create: `apps/worker/src/listing-pipeline.test.ts`

- [ ] **Step 1: Write the failing listing-schema tests**

Create `apps/worker/src/sources/listing-schema.test.ts`:

```ts
// apps/worker/src/sources/listing-schema.test.ts
import { describe, it, expect } from "vitest";
import { listingContentHash, ListingRecordSchema } from "./listing-schema.js";
import type { ListingRecord } from "@mn-platform/core";

const base: ListingRecord = {
  externalId:  "L-001",
  listingType: "sale",
  district:    "БЗД",
  khoroo:      "1-р хороо",
  rooms:       3,
  areaM2:      75.5,
  floor:       5,
  building:    "Улаанбаатар хотхон",
  priceMnt:    150_000_000,
  pricePerM2:  1_986_755,
  raw:         {},
};

describe("listingContentHash", () => {
  it("is deterministic for the same input", () => {
    expect(listingContentHash(base)).toBe(listingContentHash(base));
  });

  it("changes when priceMnt changes", () => {
    const modified = { ...base, priceMnt: 200_000_000 };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("changes when district changes", () => {
    const modified = { ...base, district: "СБД" };
    expect(listingContentHash(base)).not.toBe(listingContentHash(modified));
  });

  it("is identical regardless of raw snapshot", () => {
    const a = { ...base, raw: { scraped_at: "2026-06-12T00:00:00Z" } };
    const b = { ...base, raw: { scraped_at: "2026-06-13T00:00:00Z" } };
    expect(listingContentHash(a)).toBe(listingContentHash(b));
  });
});

describe("ListingRecordSchema", () => {
  it("accepts a valid record", () => {
    expect(() => ListingRecordSchema.parse(base)).not.toThrow();
  });

  it("rejects empty externalId", () => {
    expect(() => ListingRecordSchema.parse({ ...base, externalId: "" })).toThrow();
  });

  it("accepts all-null nullable fields", () => {
    const minimal = {
      ...base,
      district: null, khoroo: null, rooms: null,
      areaM2: null, floor: null, building: null,
      priceMnt: null, pricePerM2: null,
    };
    expect(() => ListingRecordSchema.parse(minimal)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: FAIL — `./listing-schema.js` not found.

- [ ] **Step 3: Create apps/worker/src/sources/listing-schema.ts**

```ts
// apps/worker/src/sources/listing-schema.ts
import { z } from "zod";
import { sha256 } from "@mn-platform/core";
import type { ListingRecord } from "@mn-platform/core";

export const ListingRecordSchema = z.object({
  externalId:  z.string().min(1),
  listingType: z.enum(["sale", "rent"]),
  district:    z.string().nullable(),
  khoroo:      z.string().nullable(),
  rooms:       z.number().int().nullable(),
  areaM2:      z.number().positive().nullable(),
  floor:       z.number().int().nullable(),
  building:    z.string().nullable(),
  priceMnt:    z.number().positive().nullable(),
  pricePerM2:  z.number().positive().nullable(),
  raw:         z.record(z.string(), z.unknown()),
});

/**
 * Hash canonical business fields only.
 * pricePerM2 excluded — it is derived from priceMnt/areaM2.
 * raw excluded — scrape timestamps must never affect hash.
 */
export function listingContentHash(r: ListingRecord): string {
  return sha256(
    [
      r.listingType,
      r.district    ?? "",
      r.rooms       ?? "",
      String(r.areaM2   ?? ""),
      String(r.priceMnt ?? ""),
    ].join("|"),
  );
}
```

- [ ] **Step 4: Run tests — verify listing-schema tests pass**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: all prior tests + 7 new listing-schema tests pass.

- [ ] **Step 5: Write the filter integration test**

Create `apps/worker/src/listing-pipeline.test.ts`:

```ts
// apps/worker/src/listing-pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runListingPipeline } from "@mn-platform/core";
import type { ListingPipelineDb } from "@mn-platform/core";
import type { Source, ListingRecord, UpsertOutcome } from "@mn-platform/core";
import { ListingRecordSchema, listingContentHash } from "./sources/listing-schema.js";

const outOfUbRecord: ListingRecord = {
  externalId:  "L-999",
  listingType: "sale",
  district:    null,   // outside UB — filter must reject this
  khoroo:      null,
  rooms:       null,
  areaM2:      null,
  floor:       null,
  building:    null,
  priceMnt:    null,
  pricePerM2:  null,
  raw:         {},
};

describe("runListingPipeline — filter integration", () => {
  it("skips records where source.filter returns false — upsertListing never called", async () => {
    const upsertListing = vi.fn<[], Promise<UpsertOutcome>>().mockResolvedValue("created");
    const db: ListingPipelineDb = { upsertListing };

    const source: Source<ListingRecord, ListingRecord> = {
      id:          "test.source",
      fetchPage:   async () => ({ raw: [outOfUbRecord] }),
      parse:       (r) => r,
      schema:      ListingRecordSchema,
      contentHash: listingContentHash,
      filter:      (r) => r.district !== null,
    };

    const result = await runListingPipeline(source, db);

    expect(upsertListing).not.toHaveBeenCalled();
    expect(result.new).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.fetched).toBe(1);
  });
});
```

- [ ] **Step 6: Run tests — verify filter integration test passes**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: all tests pass including the new filter integration test.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/sources/listing-schema.ts apps/worker/src/sources/listing-schema.test.ts apps/worker/src/listing-pipeline.test.ts
git commit -m "feat(worker): add ListingRecordSchema, listingContentHash, filter integration test"
```

---

### Task 5: `unegui-mn.ts` adapter (TDD)

**Files:**
- Create: `apps/worker/src/sources/unegui-mn.test.ts`
- Create: `apps/worker/src/sources/unegui-mn.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/sources/unegui-mn.test.ts`:

```ts
// apps/worker/src/sources/unegui-mn.test.ts
import { describe, it, expect } from "vitest";
import { uneguiSaleSource, uneguiRentSource } from "./unegui-mn.js";

const baseRaw = {
  price:      "150,000,000₮",
  rooms:      "3",
  area:       "75.5 м²",
  floor:      "5",
  district:   "Баянзүрх",
  khoroo:     "1-р хороо",
  building:   "Улаанбаатар хотхон",
  detailPath: "/zar/12345678/",
};

describe("source IDs", () => {
  it("uneguiSaleSource.id is unegui.mn", () => {
    expect(uneguiSaleSource.id).toBe("unegui.mn");
  });

  it("uneguiRentSource.id is unegui.mn", () => {
    expect(uneguiRentSource.id).toBe("unegui.mn");
  });
});

describe("filter", () => {
  it("returns false when district is null (outside UB)", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, district: "" });
    expect(uneguiSaleSource.filter!(record)).toBe(false);
  });

  it("returns true for a valid UB district", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(uneguiSaleSource.filter!(record)).toBe(true);
  });
});

describe("parse — listingType", () => {
  it("sale source sets listingType: sale", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.listingType).toBe("sale");
  });

  it("rent source sets listingType: rent", () => {
    const record = uneguiRentSource.parse(baseRaw);
    expect(record.listingType).toBe("rent");
  });
});

describe("parse — pricePerM2", () => {
  it("is computed as priceMnt / areaM2", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    // parseMnt("150,000,000₮") → "150000000.00" → 150_000_000
    // parseFloat("75.5 м²") → 75.5
    expect(record.pricePerM2).toBeCloseTo(150_000_000 / 75.5, 0);
  });

  it("is null when price is empty", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, price: "" });
    expect(record.pricePerM2).toBeNull();
  });

  it("is null when areaM2 is 0", () => {
    const record = uneguiSaleSource.parse({ ...baseRaw, area: "0 м²" });
    expect(record.pricePerM2).toBeNull();
  });
});

describe("parse — externalId", () => {
  it("derives externalId from detailPath trailing segment", () => {
    const record = uneguiSaleSource.parse(baseRaw);
    expect(record.externalId).toBe("12345678");
  });

  it("throws when detailPath is empty", () => {
    expect(() => uneguiSaleSource.parse({ ...baseRaw, detailPath: "" })).toThrow(
      "no externalId",
    );
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: FAIL — `./unegui-mn.js` not found.

- [ ] **Step 3: Create apps/worker/src/sources/unegui-mn.ts**

```ts
// apps/worker/src/sources/unegui-mn.ts
//
// Source adapter — unegui.mn apartment listings (sale + rent), UB only.
//
// robots.txt: MUST verify https://www.unegui.mn/robots.txt before first live run.
// Rendering: JS — Playwright + Chromium.
// Rate limit: getRateLimiter("unegui.mn") — shared for both sale and rent (same domain).
// User-Agent: honest (GazarPrice/1.0). No spoofing, no rotation.
// Compliance: store structured fields only — no description text, photos, or copyrighted content.

import { chromium } from "playwright";
import { getRateLimiter } from "@mn-platform/core";
import { normalizeDistrict, normalizeText, parseMnt } from "@mn-platform/mn";
import type { Source, ListingRecord } from "@mn-platform/core";
import { ListingRecordSchema, listingContentHash } from "./listing-schema.js";

// ── raw shape scraped from the DOM ────────────────────────────────────────────

interface RawListing {
  price:      string;
  rooms:      string;
  area:       string;
  floor:      string;
  district:   string;
  khoroo:     string;
  building:   string;
  detailPath: string;
}

// ── constants ─────────────────────────────────────────────────────────────────

const SOURCE_ID  = "unegui.mn";
const SALE_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-zarna/ulaanbaatar/";
const RENT_URL   = "https://www.unegui.mn/l-hdlh/l-hdlh-treej/ulaanbaatar/";
const USER_AGENT = "GazarPrice/1.0 (+https://gazarprice.mn; info@gazarprice.mn)";

// One token bucket for the entire unegui.mn domain — shared across sale and rent.
const limiter = getRateLimiter("unegui.mn");

/**
 * DOM selectors — update after a single browser-devtools session on
 * https://www.unegui.mn/l-hdlh/l-hdlh-zarna/ulaanbaatar/
 * All TODOs co-located so one inspect pass wires both adapters completely.
 */
const SEL = {
  CARD:        ".list-announcement-block",               // TODO: verify after live inspect
  PRICE:       ".price-title",                           // TODO: adjust column selectors
  ROOMS:       ".announcement-block__char--rooms",       // TODO: adjust
  AREA:        ".announcement-block__char--area",        // TODO: adjust
  FLOOR:       ".announcement-block__char--floor",       // TODO: adjust
  DISTRICT:    ".announcement-block__char--district",    // TODO: adjust
  KHOROO:      ".announcement-block__char--khoroo",      // TODO: adjust
  BUILDING:    ".announcement-block__char--building",    // TODO: adjust
  DETAIL_LINK: "a.announcement-block__title",            // TODO: adjust
  NEXT_PAGE:   ".pager__item--next:not(.disabled)",      // TODO: verify pagination pattern
} as const;

// ── DOM extraction (runs inside browser via $$eval) ───────────────────────────
// Must be a self-contained function — no outer-scope references.
// Playwright serialises this function body into the page context.
// Store only structured fields — never description text or image URLs.

function extractRows(els: Element[]): RawListing[] {
  return els.map((el) => {
    const text = (sel: string) => el.querySelector(sel)?.textContent?.trim() ?? "";
    const link  = el.querySelector("a[href]");
    return {
      price:      text(".price-title"),          // TODO: adjust after live inspect
      rooms:      text(".rooms-char"),            // TODO: adjust
      area:       text(".area-char"),             // TODO: adjust
      floor:      text(".floor-char"),            // TODO: adjust
      district:   text(".district-char"),         // TODO: adjust
      khoroo:     text(".khoroo-char"),           // TODO: adjust
      building:   text(".building-char"),         // TODO: adjust
      detailPath: link?.getAttribute("href") ?? "",
    };
  });
}

// ── shared parse logic ────────────────────────────────────────────────────────

function parseListing(raw: RawListing, listingType: "sale" | "rent"): ListingRecord {
  const externalId = raw.detailPath.split("/").filter(Boolean).pop() ?? "";
  if (!externalId) {
    throw new Error(
      `unegui.mn: no externalId from detailPath. Row: ${JSON.stringify(raw)}`,
    );
  }

  const areaRaw    = raw.area ? parseFloat(raw.area.replace(/[^\d.]/g, "")) : null;
  const areaM2     = areaRaw !== null && !isNaN(areaRaw) ? areaRaw : null;

  const parsedPrice = raw.price ? parseMnt(raw.price) : null;
  const priceMnt    = parsedPrice != null ? Number(parsedPrice) : null;

  const pricePerM2  = priceMnt != null && areaM2 != null && areaM2 > 0
    ? priceMnt / areaM2
    : null;

  const roomsRaw = raw.rooms ? parseInt(raw.rooms, 10) : NaN;
  const floorRaw = raw.floor ? parseInt(raw.floor, 10) : NaN;

  return {
    externalId,
    listingType,
    district:  raw.district ? normalizeDistrict(raw.district) : null,
    khoroo:    raw.khoroo   ? normalizeText(raw.khoroo)       : null,
    rooms:     !isNaN(roomsRaw) ? roomsRaw : null,
    areaM2,
    floor:     !isNaN(floorRaw) ? floorRaw : null,
    building:  raw.building ? normalizeText(raw.building)     : null,
    priceMnt,
    pricePerM2,
    raw: raw as unknown as Record<string, unknown>,
  };
}

// ── fetchPage (shared, parameterised by URL) ──────────────────────────────────

async function fetchListingPage(
  url: string,
  cursor?: string,
): Promise<{ raw: RawListing[]; nextCursor?: string }> {
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

    await page.goto(`${url}?page=${pageNum}`, {
      waitUntil: "networkidle",
      timeout:   30_000,
    });
    await page.waitForSelector(SEL.CARD, { timeout: 15_000 });
    // Randomised post-load delay — reduces burst pressure; allows lazy content to settle.
    await page.waitForTimeout(1_000 + Math.random() * 2_000);

    const raw     = await page.$$eval(SEL.CARD, extractRows);
    const hasNext = (await page.$(SEL.NEXT_PAGE)) !== null;

    return { raw, ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}) };
  } finally {
    await browser.close();
  }
}

// ── exported sources ──────────────────────────────────────────────────────────

export const uneguiSaleSource: Source<RawListing, ListingRecord> = {
  id:          SOURCE_ID,
  fetchPage:   (cursor) => fetchListingPage(SALE_URL, cursor),
  parse:       (raw)    => parseListing(raw, "sale"),
  schema:      ListingRecordSchema,
  contentHash: listingContentHash,
  filter:      (r)      => r.district !== null,
};

export const uneguiRentSource: Source<RawListing, ListingRecord> = {
  id:          SOURCE_ID,
  fetchPage:   (cursor) => fetchListingPage(RENT_URL, cursor),
  parse:       (raw)    => parseListing(raw, "rent"),
  schema:      ListingRecordSchema,
  contentHash: listingContentHash,
  filter:      (r)      => r.district !== null,
};
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: all tests pass including the 8 new unegui-mn tests.

- [ ] **Step 5: Typecheck worker**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/sources/unegui-mn.ts apps/worker/src/sources/unegui-mn.test.ts
git commit -m "feat(worker): add unegui.mn sale + rent adapters (UB-only, filter-gated)"
```

---

### Task 6: `db-adapter.ts` — add `upsertListing`

**Files:**
- Modify: `apps/worker/src/db-adapter.ts`

- [ ] **Step 1: Replace apps/worker/src/db-adapter.ts**

```ts
// apps/worker/src/db-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, tenders, listings } from "@mn-platform/db";
import type {
  PipelineDb,
  ListingPipelineDb,
  UpsertOutcome,
  TenderRecord,
  ListingRecord,
} from "@mn-platform/core";

export function createDbAdapter(): PipelineDb & ListingPipelineDb {
  return {
    async upsertTender(
      sourceId: string,
      contentHash: string,
      record: TenderRecord,
    ): Promise<UpsertOutcome> {
      const now = new Date();

      const existing = await db
        .select({ id: tenders.id, contentHash: tenders.contentHash })
        .from(tenders)
        .where(
          and(
            eq(tenders.sourceId, sourceId),
            eq(tenders.externalId, record.externalId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(tenders).values({
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
        });
        return "created";
      }

      const row = existing[0]!;

      if (row.contentHash === contentHash) {
        await db
          .update(tenders)
          .set({ lastSeenAt: now })
          .where(eq(tenders.id, row.id));
        return "unchanged";
      }

      await db
        .update(tenders)
        .set({
          contentHash,
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
        })
        .where(eq(tenders.id, row.id));
      return "updated";
    },

    async upsertListing(
      sourceId: string,
      contentHash: string,
      record: ListingRecord,
    ): Promise<UpsertOutcome> {
      const now = new Date();

      const existing = await db
        .select({ id: listings.id, contentHash: listings.contentHash })
        .from(listings)
        .where(
          and(
            eq(listings.sourceId, sourceId),
            eq(listings.externalId, record.externalId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(listings).values({
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
        });
        return "created";
      }

      const row = existing[0]!;

      if (row.contentHash === contentHash) {
        await db
          .update(listings)
          .set({ lastSeenAt: now })
          .where(eq(listings.id, row.id));
        return "unchanged";
      }

      await db
        .update(listings)
        .set({
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
        })
        .where(eq(listings.id, row.id));
      return "updated";
    },
  };
}
```

- [ ] **Step 2: Typecheck worker**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/db-adapter.ts
git commit -m "feat(worker): add upsertListing to db adapter"
```

---

### Task 7: Scheduler — Sentry + new jobs + try/catch

**Files:**
- Modify: `apps/worker/src/scheduler.ts`
- Modify: `apps/worker/package.json` (add @sentry/node)

- [ ] **Step 1: Add @sentry/node dependency**

```bash
cd D:\files\mn-data-platform && pnpm add @sentry/node --filter @mn-platform/worker
```

Expected: `@sentry/node` appears in `apps/worker/package.json` dependencies.

- [ ] **Step 2: Replace apps/worker/src/scheduler.ts**

```ts
// apps/worker/src/scheduler.ts
import * as Sentry from "@sentry/node";
import PgBoss from "pg-boss";
import { runPipeline, runListingPipeline } from "@mn-platform/core";
import type { PipelineDb, ListingPipelineDb, Source, TenderRecord } from "@mn-platform/core";
import { tenderGovMnSource } from "./sources/tender-gov-mn.js";
import { openDataTenderSource } from "./sources/opendata-tender-gov-mn.js";
import { uneguiSaleSource, uneguiRentSource } from "./sources/unegui-mn.js";
import { makeAlertDispatchHandler } from "./jobs/alert-dispatch.js";
import { logger } from "./logger.js";
import type { WorkerState } from "./types.js";

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

export async function registerJobs(
  boss: PgBoss,
  db: PipelineDb & ListingPipelineDb,
  state: WorkerState,
): Promise<void> {
  // ── scrape.tender-gov-mn ────────────────────────────────────────────────────
  const adapter = resolveTenderAdapter();
  const tenderSource: Source<unknown, TenderRecord> =
    adapter === "playwright" ? tenderGovMnSource : openDataTenderSource;

  await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.tender-gov-mn",
    { batchSize: 2 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runPipeline(tenderSource, db);
        state.lastRunAt = new Date();
        logger.info({ ...result, adapter, event: "scrape_complete" });
      } catch (err) {
        logger.error({ source: "tender.gov.mn", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── scrape.unegui-sale ──────────────────────────────────────────────────────
  await boss.schedule("scrape.unegui-sale", "0 1 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.unegui-sale",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runListingPipeline(uneguiSaleSource, db);
        state.lastRunAt = new Date();
        logger.info({ ...result, event: "scrape_complete" });
      } catch (err) {
        logger.error({ source: "unegui.mn/sale", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── scrape.unegui-rent ──────────────────────────────────────────────────────
  // 2-hour stagger from sale — same domain + rate limiter, avoid overlap.
  await boss.schedule("scrape.unegui-rent", "0 3 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.unegui-rent",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runListingPipeline(uneguiRentSource, db);
        state.lastRunAt = new Date();
        logger.info({ ...result, event: "scrape_complete" });
      } catch (err) {
        logger.error({ source: "unegui.mn/rent", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── alert.dispatch ──────────────────────────────────────────────────────────
  await boss.work(
    "alert.dispatch",
    { batchSize: 5 },
    makeAlertDispatchHandler(),
  );

  // ── export.generate ─────────────────────────────────────────────────────────
  await boss.work(
    "export.generate",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      logger.warn({ event: "export_generate_stub" }, "export.generate stub: not yet implemented");
    },
  );

  logger.info({ adapter, event: "jobs_registered" }, "all jobs registered");
}
```

- [ ] **Step 3: Update apps/worker/src/index.ts — change db parameter type**

In `apps/worker/src/index.ts`, the call to `registerJobs(boss, createDbAdapter(), state)` must satisfy the new `PipelineDb & ListingPipelineDb` parameter. Since `createDbAdapter()` now returns `PipelineDb & ListingPipelineDb`, the call site doesn't need to change. Verify the import of `createDbAdapter` is present and the call is unchanged.

If `index.ts` stores the result in a typed variable like `const db: PipelineDb`, update it to:
```ts
const db = createDbAdapter();
```
(let TypeScript infer the intersection type rather than narrowing it).

- [ ] **Step 4: Typecheck worker**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Run tests**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/scheduler.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): register unegui.mn sale+rent jobs; add Sentry try/catch to all scrape handlers"
```

---

### Task 8: Final typecheck + lint

- [ ] **Step 1: Full monorepo typecheck**

```bash
cd D:\files\mn-data-platform && pnpm typecheck
```

Expected: all packages exit 0.

- [ ] **Step 2: Full lint**

```bash
cd D:\files\mn-data-platform && pnpm lint
```

Expected: exits 0. If any errors, fix them before proceeding.

- [ ] **Step 3: Run all tests**

```bash
cd D:\files\mn-data-platform\apps\worker && pnpm test
cd D:\files\mn-data-platform\packages\core && pnpm test
```

Expected: all tests pass across both packages.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore: apply lint fixes — gazarprice adapter"
```

- [ ] **Step 5: Verify Definition of Done**

Check each item from the spec:
- [ ] `pnpm typecheck` passes — no `any`
- [ ] `pnpm lint` passes
- [ ] robots.txt for `www.unegui.mn` verified (manual step before first live run)
- [ ] Sale and rent scrapes are idempotent (re-running produces 0 new rows)
- [ ] All external input validated by `ListingRecordSchema` before DB write
- [ ] No listing description text, photos, or verbatim content stored
- [ ] `listing_type` migration applies cleanly on top of prior migrations
- [ ] `pricePerM2` is null when `areaM2 === 0` — confirmed by unegui-mn.test.ts
- [ ] Filter integration test confirms `upsertListing` never called for out-of-UB rows
- [ ] Try/catch in all three scrape handlers
