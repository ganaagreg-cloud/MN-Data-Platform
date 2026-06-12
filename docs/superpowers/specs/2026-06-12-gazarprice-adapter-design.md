# GazarPrice Adapter — Design Spec

**Date:** 2026-06-12
**Status:** Approved

## Goal

Scrape UB apartment sale and rent listings from `unegui.mn`, store only structured fields (no copyrighted text or photos), and compute `price_per_m2` for aggregate analytics. Both adapters plug into a new `runListingPipeline` that mirrors the tender pipeline but is typed for `ListingRecord`. UB-only scope enforced via a `filter` method on the `Source` interface.

---

## Compliance pre-checks (scraping-compliance skill)

| Domain | Check | Requirement |
|---|---|---|
| `unegui.mn` | `robots.txt` | **Must verify before first live run:** `curl https://www.unegui.mn/robots.txt`. Confirm listing paths are not disallowed. |
| `unegui.mn` | Rate limit | `getRateLimiter("unegui.mn")` — shared across sale and rent adapters (same domain). Default 1 req / 2 s ± 500 ms. |
| `unegui.mn` | User-Agent | `GazarPrice/1.0 (+https://gazarprice.mn; info@gazarprice.mn)` — honest, never spoofed. |
| `unegui.mn` | Content | Store only structured fields (district, rooms, area, floor, price). **Never** store or republish description text, photos, or any verbatim copyrighted content. |
| Both adapters | Provenance | `source_id`, `source_url`, `fetched_at` in `raw` snapshot, `listing_type`. |

---

## File Layout

```
packages/core/src/types.ts              ← add ListingRecord, PipelineResult (rename RunResult),
                                           UpsertOutcome (move from pipeline.ts),
                                           filter? to Source interface
packages/core/src/pipeline.ts           ← update to use PipelineResult, import UpsertOutcome from types
packages/core/src/listing-pipeline.ts  ← NEW: ListingPipelineDb + runListingPipeline
packages/core/src/index.ts             ← export ListingRecord, PipelineResult, ListingPipelineDb,
                                           runListingPipeline, UpsertOutcome (now from types)

packages/db/src/schema/index.ts        ← add listing_type column to listings
packages/db/migrations/0003_*.sql      ← ALTER TABLE + CREATE INDEX

apps/worker/src/sources/
  listing-schema.ts                    ← NEW: ListingRecordSchema (Zod) + listingContentHash
  listing-schema.test.ts               ← NEW: TDD tests
  unegui-mn.ts                         ← NEW: uneguiSaleSource + uneguiRentSource
  unegui-mn.test.ts                    ← NEW: unit tests (no live browser)

apps/worker/src/
  db-adapter.ts                        ← add upsertListing
  scheduler.ts                         ← register scrape.unegui-sale + scrape.unegui-rent,
                                           add try/catch to all three job handlers
```

---

## 1. Core type changes (`packages/core/src/types.ts`)

### 1a. Move `UpsertOutcome`

Move from `pipeline.ts` to `types.ts`:

```ts
export type UpsertOutcome = "created" | "updated" | "unchanged";
```

### 1b. Rename `RunResult` → `PipelineResult`, add `skipped`

```ts
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

Both `runPipeline` and `runListingPipeline` return `PipelineResult`. The tender pipeline always emits `skipped: 0`.

### 1c. Add `ListingRecord`

```ts
export interface ListingRecord {
  externalId: string;
  listingType: "sale" | "rent";
  district: string | null;      // normalizeDistrict() output — null means outside UB
  khoroo: string | null;
  rooms: number | null;
  areaM2: number | null;        // m², stored as number; toFixed(2) only in upsertListing
  floor: number | null;
  building: string | null;
  priceMnt: number | null;      // sale price or monthly rent; toFixed(2) only in upsertListing
  pricePerM2: number | null;    // derived: priceMnt / areaM2; null if either is null or areaM2 === 0
  raw: Record<string, unknown>;
}
```

### 1d. Add `filter?` to `Source` interface

```ts
export interface Source<TRaw, TRecord> {
  readonly id: string;
  fetchPage(cursor?: string): Promise<{ raw: TRaw[]; nextCursor?: string }>;
  parse(raw: TRaw): TRecord;
  schema: ZodSchema<TRecord>;
  contentHash(record: TRecord): string;
  /** Optional. Records where this returns false are skipped (not upserted, not alerted). */
  filter?(record: TRecord): boolean;
}
```

---

## 2. DB migration (`packages/db`)

### Schema change (`packages/db/src/schema/index.ts`)

Add to the `listings` table:

```ts
listingType: text("listing_type", { enum: ["sale", "rent"] }).notNull(),
```

Add index:

```ts
index("listings_type_district_idx").on(t.listingType, t.district),
```

### Migration SQL (`packages/db/migrations/0003_*.sql`)

```sql
ALTER TABLE "listings" ADD COLUMN "listing_type" text NOT NULL CHECK (listing_type IN ('sale', 'rent'));
CREATE INDEX "listings_type_district_idx" ON "listings" ("listing_type", "district");
```

NOT NULL is safe — zero rows in `listings`, no backfill needed.

---

## 3. `runListingPipeline` (`packages/core/src/listing-pipeline.ts`)

```ts
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
  let fetched = 0, created = 0, updated = 0, skipped = 0, errors = 0;
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
        console.error(JSON.stringify({
          source: source.id,
          event: "row_error",
          error: err instanceof Error ? err.message : String(err),
        }));
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

`filter` is checked after `schema.parse` — only structurally valid records are filtered, not thrown.

---

## 4. Shared schema (`apps/worker/src/sources/listing-schema.ts`)

```ts
export const ListingRecordSchema = z.object({
  externalId:   z.string().min(1),
  listingType:  z.enum(["sale", "rent"]),
  district:     z.string().nullable(),
  khoroo:       z.string().nullable(),
  rooms:        z.number().int().nullable(),
  areaM2:       z.number().positive().nullable(),
  floor:        z.number().int().nullable(),
  building:     z.string().nullable(),
  priceMnt:     z.number().positive().nullable(),
  pricePerM2:   z.number().positive().nullable(),
  raw:          z.record(z.string(), z.unknown()),
});

export function listingContentHash(r: ListingRecord): string {
  return sha256(
    [
      r.listingType,
      r.district        ?? "",
      r.rooms           ?? "",
      String(r.areaM2   ?? ""),
      String(r.priceMnt ?? ""),
    ].join("|"),
  );
}
```

`khoroo`, `floor`, `building`, `pricePerM2` excluded from hash — they are secondary/derived fields. A price change in `priceMnt` changes the hash; `pricePerM2` follows automatically.

---

## 5. Unegui adapter (`apps/worker/src/sources/unegui-mn.ts`)

### Constants

```ts
const SOURCE_ID   = "unegui.mn";
const SALE_URL    = "https://www.unegui.mn/l-hdlh/l-hdlh-zarna/ulaanbaatar/";
const RENT_URL    = "https://www.unegui.mn/l-hdlh/l-hdlh-treej/ulaanbaatar/";
const USER_AGENT  = "GazarPrice/1.0 (+https://gazarprice.mn; info@gazarprice.mn)";

const limiter = getRateLimiter("unegui.mn");  // shared — one token bucket for the domain

/**
 * DOM selectors — update after a single browser-devtools session on unegui.mn.
 * All TODOs co-located so one inspect pass wires both adapters completely.
 */
const SEL = {
  CARD:       ".list-announcement-block",   // TODO: verify card selector
  PRICE:      ".price-title",               // TODO: verify price selector
  ROOMS:      ".announcement-block__char--rooms", // TODO: verify
  AREA:       ".announcement-block__char--area",  // TODO: verify
  FLOOR:      ".announcement-block__char--floor", // TODO: verify
  DISTRICT:   ".announcement-block__char--district", // TODO: verify
  KHOROO:     ".announcement-block__char--khoroo",   // TODO: verify
  BUILDING:   ".announcement-block__char--building", // TODO: verify
  DETAIL_LINK: "a.announcement-block__title",        // TODO: verify
  NEXT_PAGE:  ".pager__item--next:not(.disabled)",   // TODO: verify
} as const;
```

The URLs target the UB-filtered listing pages on unegui.mn directly — fewer out-of-UB rows to filter. `source.filter` is a second safety net.

### `extractRows` (self-contained for `$$eval`)

Extracts only structured fields — no description text, no image URLs, no free-text content:

```ts
function extractRows(els: Element[]): RawListing[] {
  return els.map((el) => {
    const text = (sel: string) => el.querySelector(sel)?.textContent?.trim() ?? "";
    const link = el.querySelector("a[href]");
    return {
      price:      text(".price-title"),        // TODO: adjust after inspect
      rooms:      text(".rooms-char"),
      area:       text(".area-char"),
      floor:      text(".floor-char"),
      district:   text(".district-char"),
      khoroo:     text(".khoroo-char"),
      building:   text(".building-char"),
      detailPath: link?.getAttribute("href") ?? "",
    };
  });
}
```

### `parse(raw, listingType)` — shared pure function

```ts
function parseListing(raw: RawListing, listingType: "sale" | "rent"): ListingRecord {
  const externalId = raw.detailPath.split("/").filter(Boolean).pop() ?? "";
  if (!externalId) throw new Error(`unegui.mn: no externalId from detailPath. Row: ${JSON.stringify(raw)}`);

  const areaM2     = raw.area  ? parseFloat(raw.area.replace(/[^\d.]/g, "")) : null;
  const parsedPrice = raw.price ? parseMnt(raw.price) : null;   // parseMnt → string | null
  const priceMnt    = parsedPrice != null ? Number(parsedPrice) : null;
  const pricePerM2  = priceMnt != null && areaM2 != null && areaM2 > 0
    ? priceMnt / areaM2
    : null;

  return {
    externalId,
    listingType,
    district:   raw.district ? normalizeDistrict(raw.district) : null,
    khoroo:     raw.khoroo   ? normalizeText(raw.khoroo)       : null,
    rooms:      raw.rooms    ? parseInt(raw.rooms, 10)         : null,
    areaM2:     !isNaN(areaM2 ?? NaN) ? areaM2 : null,
    floor:      raw.floor    ? parseInt(raw.floor, 10)         : null,
    building:   raw.building ? normalizeText(raw.building)     : null,
    priceMnt,
    pricePerM2,
    raw: raw as unknown as Record<string, unknown>,
  };
}
```

### Two exported sources

```ts
export const uneguiSaleSource: Source<RawListing, ListingRecord> = {
  id: SOURCE_ID,
  async fetchPage(cursor) { /* Playwright, SALE_URL, limiter */ },
  parse: (raw) => parseListing(raw, "sale"),
  schema: ListingRecordSchema,
  contentHash: listingContentHash,
  filter: (r) => r.district !== null,
};

export const uneguiRentSource: Source<RawListing, ListingRecord> = {
  id: SOURCE_ID,
  async fetchPage(cursor) { /* Playwright, RENT_URL, limiter */ },
  parse: (raw) => parseListing(raw, "rent"),
  schema: ListingRecordSchema,
  contentHash: listingContentHash,
  filter: (r) => r.district !== null,
};
```

`fetchPage` for both: Playwright + Chromium, honest User-Agent, `locale: "mn-MN"`, `timezoneId: "Asia/Ulaanbaatar"`, `viewport: { width: 1280, height: 800 }`, `Accept-Language` header, `waitForTimeout(1_000 + Math.random() * 2_000)` post-load delay. One `chromium.launch()` / `browser.close()` per page.

---

## 6. `db-adapter.ts` extension

`createDbAdapter()` adds `upsertListing` to its returned object (same select-first pattern as `upsertTender`). The returned object satisfies both `PipelineDb` and `ListingPipelineDb` via TypeScript structural typing.

Number → string conversion in the insert/update `.set()` call:

```ts
areaM2:     record.areaM2     != null ? record.areaM2.toFixed(2)     : null,
priceMnt:   record.priceMnt   != null ? record.priceMnt.toFixed(2)   : null,
pricePerM2: record.pricePerM2 != null ? record.pricePerM2.toFixed(2) : null,
```

`upsertListing` returns `Promise<UpsertOutcome>` — the pipeline uses it to populate `result.new` / `result.updated`.

The "unchanged" path updates only `lastSeenAt` — does not overwrite `listingType` or any other field.

---

## 7. Scheduler changes (`apps/worker/src/scheduler.ts`)

Two new jobs, plus try/catch added retroactively to the existing tender job:

```ts
// Error pattern applied to all three handlers:
try {
  const result = await run...(source, db);
  state.lastRunAt = new Date();
  logger.info({ ...result, event: "scrape_complete" });
} catch (err) {
  logger.error({ source: "<source-id>", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
  Sentry.captureException(err);
  throw err; // pg-boss retries
}
```

Job schedules (Asia/Ulaanbaatar):

| Job | Cron | Notes |
|---|---|---|
| `scrape.tender-gov-mn` | `0 */2 * * *` | unchanged |
| `scrape.unegui-sale` | `0 1 * * *` | 01:00 UB daily |
| `scrape.unegui-rent` | `0 3 * * *` | 03:00 UB daily — 2h stagger, same domain/rate-limiter |

`batchSize: 1` for both listing jobs — Playwright scrapes are heavy, never run concurrently.

---

## 8. Tests

### `apps/worker/src/sources/listing-schema.test.ts`

- `listingContentHash` is deterministic for the same input
- Hash changes when `priceMnt` changes
- Hash changes when `district` changes
- Hash is identical regardless of `raw` snapshot contents
- `ListingRecordSchema` accepts a valid record
- `ListingRecordSchema` rejects empty `externalId`
- `ListingRecordSchema` accepts all-null nullable fields

### `apps/worker/src/sources/unegui-mn.test.ts`

- `uneguiSaleSource.id === "unegui.mn"` and `uneguiRentSource.id === "unegui.mn"`
- `filter` returns `false` when `district === null`, `true` for a valid UB district (`"БЗД"`)
- `uneguiSaleSource.parse(raw)` sets `listingType: "sale"`
- `uneguiRentSource.parse(raw)` sets `listingType: "rent"`
- `pricePerM2` computed correctly (`priceMnt / areaM2`)
- `pricePerM2` is `null` when `priceMnt` is null
- `pricePerM2` is `null` when `areaM2` is `0`

### `apps/worker/src/listing-pipeline.test.ts`

- Records where `source.filter` returns `false` are skipped: `upsertListing` not called, `result.new === 0`, `result.updated === 0`, `result.skipped === 1`

---

## Definition of Done

- [ ] `pnpm typecheck` passes — no `any`.
- [ ] `pnpm lint` passes.
- [ ] `robots.txt` for `www.unegui.mn` verified before first live run.
- [ ] Sale and rent scrapes are idempotent: re-running produces 0 new rows.
- [ ] All external input validated by `ListingRecordSchema` before DB write.
- [ ] No listing description text, photos, or verbatim copyrighted content stored or logged.
- [ ] `listing_type` migration applies cleanly on top of prior migrations.
- [ ] `pricePerM2` computed as `null` when `areaM2 === 0` (no division by zero).
- [ ] `filter` integration test confirms `upsertListing` is never called for out-of-UB rows.
- [ ] Try/catch in all three scheduler job handlers — pg-boss retries on rethrow.
