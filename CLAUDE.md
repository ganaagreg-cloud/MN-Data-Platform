# CLAUDE.md — Mongolian Data Platform (Tender + Gazar)

One monorepo, two products built on a shared ingestion core:

- **TenderAlert** — aggregates Mongolian government procurement (tender.gov.mn + ministry portals), alerts businesses on matching tenders before deadlines.
- **GazarPrice** — aggregates Ulaanbaatar apartment listings into normalized price-per-m² intelligence (aggregate stats only — see scraping-compliance skill).

Both are: scheduled scraper → parse/extract → validate → dedup → upsert to Postgres → serve via a single Next.js dashboard (`apps/platform`) + alerts → bill via QPay. If you are touching a scraper, read the `source-adapter` skill. If you are touching the DB, read `postgres-conventions`. If you touch any Mongolian field, read `mongolian-data`.

## Definition of Done (gate — do not mark work complete until ALL pass)

1. `pnpm typecheck` passes (no `any` to silence errors).
2. `pnpm lint` passes.
3. New ingestion paths are **idempotent** (re-running the same scrape produces zero duplicates and zero double-alerts).
4. Every external input is validated with a Zod schema before it touches the DB.
5. Error / loading / empty states exist for any new UI surface.
6. No secrets in code or committed files. No raw SQL string interpolation.
7. Scrapers respect robots.txt + per-domain rate limit + store provenance. GazarPrice never republishes raw copyrighted listing text — derived/aggregate fields only.

## Stack (do not substitute without saying why)

- **Monorepo:** pnpm workspaces + Turborepo.
- **Language:** TypeScript (strict). Node 20+.
- **DB:** PostgreSQL. ORM: **Drizzle** (migrations in `packages/db/migrations`). Host in **ap-northeast (Tokyo) or Singapore** — never US/EU (latency to Mongolia). Connection pooling required.
- **Queue + cron:** **pg-boss** (Postgres-backed — zero extra infra). All scrapers run as scheduled pg-boss jobs in `apps/worker`, never inline in a request.
- **Scraping:** Playwright for JS-rendered pages (tender.gov.mn), `undici` fetch for static. One `RateLimiter` per domain.
- **Extraction:** parser-first; fall back to Claude API (Sonnet) only for messy free-text fields, then validate output with Zod.
- **Web:** Next.js 15 App Router, Tailwind, shadcn/ui (see `production-ui-design` skill if present).
- **Alerts:** Resend email (free tier, default); Telegram Bot API (free add-on, zero marginal cost); Mongolian SMS provider (paid add-on, billed as a QPay subscription line item).
- **Billing:** QPay invoice + webhook (see `qpay-billing`). Subscription is a state machine.
- **Observability:** Sentry + `pino` structured logs. Every scrape run logs `{source, fetched, new, updated, errors, durationMs}`.
- **Auth:** Auth.js (B2B email/password + org accounts).

## Repo layout

```
packages/core          # Source interface, pipeline runner, RateLimiter, hashing
packages/db            # Drizzle schema + migrations (single source of truth)
packages/mn            # Mongolian utils (Cyrillic, MNT, dates, districts, state-reg)
apps/worker            # pg-boss workers + scheduled scrape jobs
apps/platform          # Single Next.js 15 app, one deployment
  app/(tender)/        #   TenderAlert route group
  app/(gazar)/         #   GazarPrice route group
```

Shared logic lives in `packages/*`. Product apps import; they do not duplicate ingestion or schema.

## Ingestion contract (every source implements this)

```ts
interface Source<TRaw, TRecord> {
  id: string;                       // stable, e.g. "tender.gov.mn"
  fetchPage(cursor?: string): Promise<{ raw: TRaw[]; nextCursor?: string }>;
  parse(raw: TRaw): TRecord;        // pure; throws on unparseable
  schema: ZodSchema<TRecord>;       // validates parse() output
  contentHash(r: TRecord): string;  // canonical fields only → sha256
}
```

Pipeline (in `packages/core`): fetch → parse → `schema.parse` → `contentHash` → upsert on `(source_id, external_id)` with hash compare. Alert/notify is a **separate** stage keyed on hash change, idempotent on `(record_id, hash)`. Never alert inside the scrape transaction.

## Domain glossary

**TenderAlert** — source `tender.gov.mn` (Цахим худалдан авах ажиллагаа).
Fields: `tender_no`, `procuring_entity` (захиалагч), `category`, `est_budget_mnt` (төсөвт өртөг), `announce_date`, `submission_deadline`, `bid_security_mnt` (тендерийн баталгаа), `aimag` (region). Status machine: `announced → open → closed → awarded → cancelled`. Matching = keyword + category rules against a customer's saved profile.

**Subscription** — has a `modules: ("tender" | "gazar")[]` field. UI routes and API access are gated per module; a user subscribed to both sees both route groups, otherwise only their active module(s).

**GazarPrice** — apartment = байр.
Fields: `district` (дүүрэг, enum: БЗД Баянзүрх / СБД Сүхбаатар / ЧД Чингэлтэй / ХУД Хан-Уул / СХД Сонгинохайрхан / БГД Баянгол / Налайх / Багануур / Багахангай), `khoroo` (хороо), `rooms` (өрөө), `area_m2` (м²), `floor` (давхар), `building`, `price_mnt`, `price_per_m2` (derived). Republish only aggregates (median ₮/m² by district/building/month), never the source listing text or photos.

## Anti-patterns — BLOCK these (recurring failure modes)

- **Unverified package/API names.** Before importing a package or calling a library API you are not 100% sure exists at the named version, check it (Context7 MCP or the installed `package.json`). Do not invent `pg-boss.schedule()`-style signatures from memory — verify. Do not backtrack on a correct answer because I pushed back; if you are right, hold and show evidence.
- Running scrapers inside an HTTP request or Next.js route. They run in `apps/worker` only.
- Non-idempotent upserts or alerts (causes duplicate emails — instant churn).
- `SELECT *` or unbounded queries on listing/tender tables (millions of rows). Always paginate + index.
- Storing secrets in code, `.env` committed, or QPay/bank tokens unencrypted.
- Naive `new Date(string)` on Mongolian dates — use `packages/mn` parsers.
- Republishing scraped copyrighted listing content (GazarPrice legal risk).

## Session continuity

Keep a `## Progress` log at the bottom of this file: what's done, what's mid-flight, the next concrete step. Update it before `/exit`. Use task-scoped sessions; start fresh per feature.

## Progress

- [x] Monorepo scaffold — packages/core, packages/db, packages/mn, apps/worker, apps/platform all have package.json + tsconfig + src stubs. drizzle.config.ts, next.config.ts, migrations/ dir created. All typechecks pass.
- [x] Drizzle schema — organizations, users, subscriptions, tenders, listings in src/schema/index.ts. Migration 0000 applied and verified (5 tables live). db:migrate script uses node --env-file to auto-load .env.
- [x] `tender.gov.mn` source adapter — packages/core has Source interface, TenderRecord, runPipeline, sha256, RateLimiter. packages/mn has parseMnDate, parseMnt/formatMnt, normalizeDistrict, normalizeText. apps/worker/src/sources/tender-gov-mn.ts has Playwright adapter + Zod schema. pnpm typecheck 5/5 green. Two TODO selectors (ROW_SELECTOR + pagination) need one manual browser inspect to fill in.
- [x] pg-boss worker boot + graceful shutdown, health check HTTP server, job handlers (scrape, alert, export), pg-boss scheduler.
- [x] Docker setup — two-stage Dockerfile, .dockerignore, docker-compose.yml. Builds successfully with mn-worker:local image (312MB). Node.js 22-slim + system deps for Playwright+Chromium.
- [ ] Alert pipeline (email) — Plan 2 ready, execute next
- [x] tender.gov.mn Playwright adapter replacement + opendata stub — TENDER_ADAPTER env flag, fetchedVia provenance, opendata stub with token check. Plan 3 complete.
- [x] GazarPrice unegui.mn adapter — ListingRecord (number|null), runListingPipeline, filter? on Source, listings.listing_type migration (0003, NOT NULL + CHECK), uneguiSaleSource + uneguiRentSource (Playwright, UB-only filter), upsertListing in db-adapter, Sentry try/catch on all 3 scrape handlers. 40 tests pass. Plan 4 complete.
- [ ] QPay subscription flow
