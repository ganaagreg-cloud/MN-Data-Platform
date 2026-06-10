# tender.gov.mn Source Adapters + TENDER_ADAPTER env flag

**Date:** 2026-06-10
**Status:** Approved

## Goal

Replace the scaffold `tender-gov-mn.ts` (which targeted `tender.gov.mn/mn/tender/list`
with un-inspected selectors) with a production-quality Playwright adapter targeting
`user.tender.gov.mn/mn/invitation`. Scaffold a typed stub for `opendata.tender.gov.mn`
(Bearer POST API) behind the same `Source` interface so it can be wired in without
touching dispatch logic. A single `TENDER_ADAPTER` env flag selects which adapter
the worker registers at startup — never both simultaneously.

---

## Compliance pre-checks (scraping-compliance skill)

| Domain | Check | Status |
|---|---|---|
| `user.tender.gov.mn` | `robots.txt` | **Must verify before first live run:** `curl https://user.tender.gov.mn/robots.txt`. The prior scaffold noted `tender.gov.mn` as `Allow: /` — that is a different subdomain. |
| `opendata.tender.gov.mn` | `robots.txt` | Verify once token arrives and API docs are available. |
| Both | Rate limit | `getRateLimiter(domain)` per subdomain — separate limiters, default 1 req / 2 s ± 500 ms. |
| Both | User-Agent | `TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)` — honest, never spoofed. |
| Both | Provenance | `source_id`, `source_url`, `fetched_at` (in `raw` snapshot), `fetched_via`. |

---

## File Layout

```
packages/core/src/types.ts                    ← add fetchedVia: string to TenderRecord
packages/db/src/schema/index.ts               ← add fetched_via text nullable to tenders
packages/db/migrations/<next>_*.sql           ← ALTER TABLE tenders ADD COLUMN fetched_via text
                                               (run after alert-pipeline migration)

apps/worker/src/sources/
  tender-schema.ts                            ← shared TenderRecordSchema, tenderContentHash
  tender-gov-mn.ts                            ← REPLACED: Playwright adapter
  opendata-tender-gov-mn.ts                   ← NEW: REST API stub

apps/worker/src/scheduler.ts                  ← reads TENDER_ADAPTER, registers one job
```

---

## 1. Core type change (`packages/core/src/types.ts`)

Add to `TenderRecord`:

```ts
/**
 * Which adapter wrote this record. "playwright" | "api" | future adapters.
 * Excluded from contentHash — switching adapters does not trigger re-alerts.
 */
fetchedVia: string;
```

---

## 2. DB migration — `fetched_via` column

Drizzle schema addition in `packages/db/src/schema/index.ts` (inside the `tenders` table):

```ts
fetchedVia: text("fetched_via"),   // nullable; null on rows written before this migration
```

Generated migration SQL:

```sql
ALTER TABLE tenders ADD COLUMN fetched_via text;
```

No index needed — `fetched_via` is a provenance label, not a query predicate.

**Upsert behaviour:**
- `"created"` → write `fetched_via`.
- `"updated"` (hash changed) → write `fetched_via`.
- `"unchanged"` → update `last_seen_at` only; do **not** overwrite `fetched_via`. The record
  content hasn't changed, so there is no reason to record a new fetch method.

---

## 3. Shared schema (`apps/worker/src/sources/tender-schema.ts`)

Single source of truth for both adapters — prevents drift between the Playwright and API
output shapes.

```ts
export const TenderRecordSchema = z.object({
  externalId:          z.string().min(1),
  tenderNo:            z.string().nullable(),
  procuringEntity:     z.string().nullable(),
  category:            z.string().nullable(),
  estBudgetMnt:        z.string().nullable(),
  announceDate:        z.date().nullable(),
  submissionDeadline:  z.date().nullable(),
  bidSecurityMnt:      z.string().nullable(),
  aimag:               z.string().nullable(),
  status:              z.string(),
  fetchedVia:          z.string(),
  raw:                 z.record(z.string(), z.unknown()),
});

/**
 * Hash only canonical business fields.
 * fetchedVia intentionally excluded — switching adapters must not trigger re-alerts.
 * scrape timestamps must never appear here.
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

---

## 4. Playwright adapter (`apps/worker/src/sources/tender-gov-mn.ts`)

**Replaces** the scaffold file. Targets `https://user.tender.gov.mn/mn/invitation`.

### Constants

```ts
const SOURCE_ID  = "tender.gov.mn";
const LIST_URL   = "https://user.tender.gov.mn/mn/invitation";
const USER_AGENT = "TenderAlert/1.0 (+https://tenderalert.mn; info@tenderalert.mn)";

/**
 * DOM selectors — update this block after a single browser-devtools session.
 * All TODOs here are co-located so one inspect pass wires the adapter completely.
 */
// Rate limiter is keyed on the subdomain being hit, not the source_id.
// user.tender.gov.mn and opendata.tender.gov.mn get independent token buckets.
const limiter = getRateLimiter("user.tender.gov.mn");  // 1 req / 2 s ± 500 ms default

const SEL = {
  ROW:        "table tbody tr",          // TODO: verify selector after live inspect
  TENDER_NO:  "td:nth-child(1)",         // TODO: adjust column indices
  TITLE:      "td:nth-child(2)",
  ENTITY:     "td:nth-child(3)",
  CATEGORY:   "td:nth-child(4)",
  BUDGET:     "td:nth-child(5)",
  DEADLINE:   "td:nth-child(6)",
  STATUS:     "td:nth-child(7)",
  AIMAG:      "td:nth-child(8)",
  DETAIL_LINK: "a[href]",
  NEXT_PAGE:  ".pagination .next:not(.disabled)", // TODO: verify pagination pattern
} as const;
```

### Browser context

```ts
await browser.newContext({
  userAgent: USER_AGENT,
  locale: "mn-MN",
  timezoneId: "Asia/Ulaanbaatar",
  viewport: { width: 1280, height: 800 },
  extraHTTPHeaders: {
    "Accept-Language": "mn-MN,mn;q=0.9,en-US;q=0.8,en;q=0.7",
  },
});
```

`userAgent` is honest. `locale`, `timezoneId`, `viewport`, and `Accept-Language` reflect
the app's actual audience and ensure responsive layouts render at full width with correct
locale formatting. No spoofing; no UA rotation.

### Randomised post-load delay

Applied **after** `waitUntil: "networkidle"`, **before** DOM extraction:

```ts
await page.waitForTimeout(1_000 + Math.random() * 2_000);  // 1–3 s
```

This is in addition to the rate limiter's inter-request spacing. It reduces burst pressure
on the portal and allows lazy-rendered content to settle.

### `fetchPage` skeleton

```ts
async fetchPage(cursor) {
  const pageNum = cursor !== undefined ? parseInt(cursor, 10) : 1;
  await limiter.acquire();

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ /* as above */ });
    const page = await ctx.newPage();

    await page.goto(`${LIST_URL}?page=${pageNum}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForSelector(SEL.ROW, { timeout: 15_000 });
    await page.waitForTimeout(1_000 + Math.random() * 2_000);

    const raw = await page.$$eval(SEL.ROW, (els) => extractRows(els, SEL));

    const hasNext = (await page.$(SEL.NEXT_PAGE)) !== null;
    return { raw, ...(hasNext ? { nextCursor: String(pageNum + 1) } : {}) };
  } finally {
    await browser.close();
  }
}
```

One `chromium.launch()` / `browser.close()` per page — keeps memory stable across a
full paginated run.

### `parse`

- `externalId`: `tenderNo` if non-empty; else trailing path segment of `detailPath`.
  Throws `Error` (not returns null) if both are absent — pipeline logs and skips the row.
- All string fields: `normalizeText()` (NFC + trim + collapse whitespace) before storing.
- All date fields: `parseMnDate()` — never `new Date(string)`.
- All money fields: `parseMnt()` → `string | null` (stored as `numeric(18,2)`).
- `fetchedVia: "playwright"`.

### `contentHash`

Delegates to `tenderContentHash(r)` from `tender-schema.ts`.

---

## 5. OpenData stub (`apps/worker/src/sources/opendata-tender-gov-mn.ts`)

```ts
const SOURCE_ID = "tender.gov.mn";   // same — fallback chain, never simultaneous
const BASE_URL  = "https://opendata.tender.gov.mn";

interface RawApiTender extends Record<string, unknown> {}   // placeholder until API docs

export const openDataTenderSource: Source<RawApiTender, TenderRecord> = {
  id: SOURCE_ID,

  async fetchPage(cursor) {
    const token = process.env["OPENDATA_BEARER_TOKEN"];
    if (!token) {
      throw new Error(
        "opendata.tender.gov.mn: OPENDATA_BEARER_TOKEN env var not set — adapter cannot run",
      );
    }
    // TODO: implement POST to BASE_URL with Bearer auth and cursor/page params.
    // Add getRateLimiter("opendata.tender.gov.mn").acquire() before the fetch call.
    // Map response envelope to { raw: RawApiTender[], nextCursor? }.
    throw new Error("opendata.tender.gov.mn: fetchPage not yet implemented");
  },

  parse(_raw: RawApiTender): TenderRecord {
    // TODO: map API JSON fields → TenderRecord using packages/mn helpers.
    // Set fetchedVia: "api".
    throw new Error("opendata.tender.gov.mn: parse not yet implemented");
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
```

The stub is a valid `Source` that compiles cleanly and fails fast with a clear message.
Rate limiter is intentionally absent (no real request made); add it when implementing
`fetchPage`.

### Environment variables

| Var | Used by | Notes |
|---|---|---|
| `OPENDATA_BEARER_TOKEN` | `opendata-tender-gov-mn.ts` | Required when `TENDER_ADAPTER=api`; startup error if unset |

---

## 6. `TENDER_ADAPTER` flag in `scheduler.ts`

```ts
type TenderAdapter = "playwright" | "api";

function resolveTenderAdapter(): TenderAdapter {
  const raw = process.env["TENDER_ADAPTER"] ?? "playwright";
  if (raw !== "playwright" && raw !== "api") {
    throw new Error(`TENDER_ADAPTER must be "playwright" or "api", got "${raw}"`);
  }
  return raw;
}
```

In `registerJobs(boss, db, state)`:

```ts
const adapter = resolveTenderAdapter();
const tenderSource =
  adapter === "playwright" ? tenderGovMnSource : openDataTenderSource;

await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", null, {
  tz: "Asia/Ulaanbaatar",
});
await boss.work("scrape.tender-gov-mn", { localConcurrency: 2 }, async ([job]) => {
  const result = await runPipeline(tenderSource, db);
  state.lastRunAt = new Date();
  logger.info({ ...result, adapter, event: "scrape_complete" });
});
```

Both adapters are imported at the top of `scheduler.ts`. Only the selected one is passed
to `runPipeline` — the other is loaded but never executes. Validation throws at startup,
not at job-run time, so a misconfigured worker fails immediately rather than on the first
scheduled tick.

### Environment variables (summary)

| Var | Default | Notes |
|---|---|---|
| `TENDER_ADAPTER` | `"playwright"` | `"playwright"` or `"api"` |
| `OPENDATA_BEARER_TOKEN` | — | Required when `TENDER_ADAPTER=api` |

---

## Definition of Done

All CLAUDE.md gates must pass before marking implementation complete:

- [ ] `pnpm typecheck` passes — no `any`.
- [ ] `pnpm lint` passes.
- [ ] `robots.txt` for `user.tender.gov.mn` verified `Allow: /` before first live run.
- [ ] Scrape job is idempotent: re-running against the same page produces 0 new rows and
      0 duplicate `notifications_sent` entries.
- [ ] All external input validated by `TenderRecordSchema` (Zod) before DB write.
- [ ] `TENDER_ADAPTER` validation throws at worker startup, not at first job tick.
- [ ] `OPENDATA_BEARER_TOKEN` absence throws a clear error message (not a crash with a
      null-deref stack trace).
- [ ] `fetched_via` migration applies cleanly on top of all prior migrations.
- [ ] `fetchedVia` is absent from `contentHash` — verified by checking that the same
      tender scraped via both adapters produces identical hashes.
- [ ] No raw scraped text or bearer token appears in logs.
