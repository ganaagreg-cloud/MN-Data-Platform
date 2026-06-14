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
- **Scraping:** Crawlbase Crawling API (JS rendering) + `cheerio` for unegui.mn and tender.gov.mn; `undici` fetch for static. One `RateLimiter` per domain.
- **Extraction:** parser-first; fall back to Claude API (Sonnet) only for messy free-text fields, then validate output with Zod.
- **Web:** Next.js 15 App Router, Tailwind, shadcn/ui (see `production-ui-design` skill if present).
- **Alerts:** Telegram Bot API — the only notification channel (no email/Resend, no SMS/Viber; see UI & architecture rules).
- **Billing:** QPay invoice + webhook (see `qpay-billing`). Subscription is a state machine.
- **Observability:** Sentry + `pino` structured logs. Every scrape run logs `{source, fetched, new, updated, errors, durationMs}`.
- **Auth:** Telegram bot deep-link login (no password/OTP/email) is the primary auth for `apps/platform` — see `docs/superpowers/specs/2026-06-13-telegram-auth-design.md`. `users.org_id`/`email` are nullable and used only for the optional B2B overlay (Auth.js email/password + org accounts is deferred until that overlay is built).

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

## UI & architecture rules

**Frontend (`apps/platform`):**
- Tailwind v4 is wired up: `apps/platform/postcss.config.mjs` (`@tailwindcss/postcss`) + `apps/platform/src/app/globals.css` (`@import "tailwindcss";` plus a `@theme { ... }` block with the `mn-*` design tokens — Tailwind v4 is CSS-first config), imported from `layout.tsx`. Use CSS Modules (`*.module.css`) alongside Tailwind utilities for keyframe animations and `:hover` rules that need to override inline `style` props (use `!important` in that case — see `page.module.css`).
- No component library installed yet. Planned: shadcn/ui. `@/*` → `apps/platform/src/*` is already aliased in `tsconfig.json`, matching shadcn's default imports — primitives go in `apps/platform/src/components/ui/`.
- No icon package installed. shadcn's default is `lucide-react` — add it when the first icon is needed.
- `<html lang="mn">` is set and most UI copy (district names, etc.) is Cyrillic — any `next/font/google` font MUST declare `subsets: ["cyrillic"]`.
- Static assets go in `apps/platform/public/` (doesn't exist yet), served via `next/image`.
- Never reimplement currency/date/district formatting in UI code — always use `packages/mn` (`formatMnt`, `parseMnDate`, `normalizeDistrict`, `normalizeText`).
- New pages live under `app/(tender)/` or `app/(gazar)/` per product; internal/admin-only tooling goes at the app root (e.g. `app/admin/`).

**Data model / pipeline guardrails (do not regress):**
- Listings unique key is `(source_id, external_id, listing_type)` — not just `(source_id, external_id)`. unegui.mn reuses the same numeric ID across its sale and rent feeds (see migration 0004); a 2-column key corrupts the cross-feed row.
- `listingContentHash` must include `khoroo`, `floor`, and `building` (in addition to listingType/district/rooms/areaM2/priceMnt) — omitting any of these causes missed change-alerts.
- `areaM2` and `priceMnt` Zod validators use `.nonnegative()`, not `.positive()` — zero-value listings are logged via `warnZeroValueListing` but still upserted, never rejected.
- Telegram is the notification channel — not email/Resend, not SMS/Viber.

**Auth flow (built so far — see `docs/superpowers/specs/2026-06-13-telegram-auth-design.md`):**
- `app/(gazar)/login` (server component) creates an `auth_tokens` row (32-char hex token, 5-minute TTL) and renders a `t.me/{BOT_USERNAME}?start=auth_{token}` deep-link plus `<LoginPoller>`; the client polls `checkLoginStatus` every 2s.
- `app/api/telegram/webhook/route.ts` handles `/start auth_<token>`: upserts the `users` row by `telegram_id`, marks the token consumed, replies in Mongolian.
- On a claimed token, `checkLoginStatus` sets an HMAC-SHA256 signed session cookie (`httpOnly`, `sameSite: lax`, `secure` in production, 30-day `maxAge`) and redirects to `app/(gazar)/dashboard` (session-gated stub).
- TenderAlert has no `app/(tender)/` pages yet — `/login` and `/dashboard` exist only under `(gazar)` so far; the same session (gated by `users.id`, not by route group) will be reused once TenderAlert pages are built.

**Tooling:**
- Never write `node ./node_modules/.bin/<bin>` in a `package.json` script — call the binary name directly (`tsc`, `eslint`, `next`, `tsx`, `turbo`, ...). pnpm puts workspace bins on `PATH`.

## Session continuity

Keep a `## Progress` log at the bottom of this file: what's done, what's mid-flight, the next concrete step. Update it before `/exit`. Use task-scoped sessions; start fresh per feature.

## Progress

- [x] Monorepo scaffold — packages/core, packages/db, packages/mn, apps/worker, apps/platform all have package.json + tsconfig + src stubs. drizzle.config.ts, next.config.ts, migrations/ dir created. All typechecks pass.
- [x] Drizzle schema — organizations, users, subscriptions, tenders, listings in src/schema/index.ts. db:migrate script uses node --env-file to auto-load .env. Migrations 0000-0005 applied: 0000 initial 5 tables; 0001 notifications_sent + users.telegram_chat_id/phone; 0002 tenders.fetched_via; 0003 listings.listing_type (3-phase: nullable -> backfill 'sale' -> NOT NULL+CHECK) + listings_type_district_idx; 0004 listings unique key (source_id, external_id, listing_type) replacing (source_id, external_id); 0005 auth_tokens table + users.telegram_id/telegram_username/first_name/last_login_at (org_id/email now nullable).
- [x] `tender.gov.mn` source adapter — packages/core has Source interface, TenderRecord, runPipeline, sha256, RateLimiter. packages/mn has parseMnDate, parseMnt/formatMnt, normalizeDistrict, normalizeText. apps/worker/src/sources/tender-gov-mn.ts has Zod schema + extractRows (now Crawlbase+cheerio, see Crawlbase adapter swap entry below for selector status). pnpm typecheck 5/5 green.
- [x] pg-boss worker boot + graceful shutdown, health check HTTP server, job handlers (scrape, alert, export), pg-boss scheduler.
- [x] Docker setup — two-stage Dockerfile, .dockerignore, docker-compose.yml. Builds successfully with mn-worker:local image. Node.js 22-slim (Chromium system-deps removed — see Crawlbase adapter swap entry below).
- [ ] Alert pipeline (email) — Plan 2 ready, execute next
- [x] tender.gov.mn adapter selection + opendata stub — TENDER_ADAPTER env flag ("scrape" | "api"), fetchedVia provenance, opendata stub with token check. Plan 3 complete.
- [x] GazarPrice unegui.mn adapter — ListingRecord (number|null), runListingPipeline, filter? on Source, listings.listing_type migration (0003, NOT NULL + CHECK), uneguiSaleSource + uneguiRentSource (UB-only filter; now Crawlbase+cheerio, see Crawlbase adapter swap entry below), upsertListing in db-adapter, Sentry try/catch on all 3 scrape handlers. Plan 4 complete.
- [x] Listing pipeline bug-fix pass (commit 386c04a) — fixed 4 bugs found after the GazarPrice adapter landed: (1) migration 0003 rewritten as a safe 3-phase sequence (add nullable -> backfill 'sale' -> SET NOT NULL + CHECK) so it doesn't fail on a populated table; (2) `listingContentHash` now includes `khoroo`/`floor`/`building` so changes to those fields trigger alerts; (3) `ListingRecordSchema` uses `.nonnegative()` not `.positive()` for areaM2/priceMnt/pricePerM2, so legitimate zero-value listings are upserted (flagged via `warnZeroValueListing`) instead of rejected; (4) `db-adapter` upsertListing/getPreviousListingPrice now key on `(sourceId, externalId, listingType)`, fixing sale/rent ID collisions on unegui.mn (migration 0004 adds the matching 3-column unique index, replacing the 2-column one). These are now permanent contracts — see "Data model / pipeline guardrails" above.
- [x] Telegram ops notification feed — packages/core/src/notifications/telegram.ts (sendTelegramMessage via fetch, formatListingAlert, formatTenderAlert). runPipeline gained optional getPrevious?/onChanged? hooks (additive, called for created|updated only, never for unchanged). db-adapter.getPreviousListingPrice captures the pre-upsert price for diffs. All 3 scrape jobs (tender.gov.mn, unegui-sale, unegui-rent) ping TELEGRAM_CHAT_ID on new/changed records — best-effort, errors logged + swallowed so a Telegram outage never fails the scrape job. Internal ops feed only, separate from the per-user dispatchAlert/notifications_sent system below. TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID added to env schema + .env.example. typecheck/lint/tests all green across packages/core + apps/worker.
- [ ] Alert pipeline (customer-facing, per-user) — apps/worker/src/jobs/alert-dispatch.ts is still Resend/email-based, contradicting the "Telegram is the only notification channel" rule. Needs a Telegram ChannelProvider keyed on a per-user chat id before this can ship; not yet started.
- [x] Telegram bot deep-link auth — users table extended (telegram_id/telegram_username/first_name/last_login_at, org_id/email nullable), new auth_tokens table (migration 0005). packages/core gained sendTelegramMessageTo(chatId, text). apps/worker/src/alerts/dispatch.ts handles null org_id (early-return) and null email (per-channel gate); ResendEmailProvider defends recipient.email. apps/platform gained env.ts (BOT_USERNAME, SESSION_SECRET, DATABASE_URL_DIRECT), lib/session.ts (HMAC cookie), lib/auth-tokens.ts, app/api/telegram/webhook/route.ts, app/(gazar)/login (page + poller + checkLoginStatus action), app/(gazar)/dashboard stub. Webhook registration + end-to-end flow require manual setWebhook (see plan Task 10 Step 6) — not yet run against a real bot. Follow-ups flagged by code review (not yet started): (1) webhook's users.telegramId upsert has a narrow TOCTOU race on concurrent /start redelivery — consider onConflictDoUpdate; (2) apps/platform has no pino/Sentry yet (webhook catch uses console.error); (3) webhook route has no X-Telegram-Bot-Api-Secret-Token validation — add before exposing publicly.
- [x] Crawlbase adapter swap — unegui-mn.ts and tender-gov-mn.ts fetchPage now call packages/core's fetchRenderedHtml (Crawlbase Crawling API, JS rendering) and parse the returned HTML with cheerio; getRateLimiter, Source shape, parseListing/parse, filter, and contentHash unchanged. New apps/worker/src/sources/selector-guard.ts (selectorPresent) backs checkListingContainer (unegui) and new checkRowContainer (tender), both now synchronous. tender-gov-mn's fetchedVia is "crawlbase"; TENDER_ADAPTER values renamed "playwright"|"api" -> "scrape"|"api" (default "scrape") in scheduler.ts. Removed: playwright dependency, apps/worker/src/sentry-filters.ts (+test) and its beforeSend wiring in instrument.ts, Dockerfile Chromium system-deps block. Added CRAWLBASE_TOKEN to env.ts/.env.example. Design: docs/superpowers/specs/2026-06-14-crawlbase-adapter-design.md. **Next concrete step:** the extraction + selector-guard pipeline is built and test-covered, but the live selector values themselves (SEL.CARD/SEL.ROW and the per-column `td:nth-child`/class selectors in both adapters) are still `// TODO: verify after live inspect` placeholders — one manual browser inspect pass against unegui.mn and tender.gov.mn is needed to confirm/fill them in before either adapter can write real rows.
- [ ] TenderAlert matching engine + saved profiles — keyword + category rules against a customer's saved profile (see Domain Glossary). Not yet started; the customer-facing alert pipeline above depends on this existing.
- [ ] QPay subscription flow
- [x] Landing page (`apps/platform/src/app/page.tsx`) — ported the Claude Design handoff `mn-platform-landing-page/project/МН Платформ Landing.dc.html` pixel-for-pixel into a `"use client"` React component. Wired up Tailwind v4 CSS-first config (`apps/platform/postcss.config.mjs`, `apps/platform/src/app/globals.css` with `@theme` tokens for the mn-* palette, `layout.tsx` loads Inter + JetBrains Mono with cyrillic+latin subsets). `page.module.css` holds the keyframes (`mnpulse`/`mnblink`/`mndraw`/`mnfloat`), the `.reveal`/`.revealed` scroll-in animation, and `:hover` rules with `!important` (needed to override the inline `style` colors ported from the prototype's `style-hover` attributes). Page covers nav, hero (live MM:SS countdown + SVG chart), stats, problem section, how-it-works (Тендер/Үл хөдлөх tab switcher), live data cards, pricing tiers, mock Telegram-login CTA, and footer, with an IntersectionObserver driving scroll-reveal. `pnpm typecheck`/`pnpm lint` green; verified visually against the dev server with Playwright across every section, both how-it-works tabs, and the Telegram login state toggle.
