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
- **Auth:** Telegram Login Widget + Auth.js v5 (`next-auth@5.0.0-beta.31`, Credentials provider verifying the widget's HMAC payload, JWT sessions) is the primary auth for `apps/platform` — see `docs/superpowers/specs/2026-06-14-telegram-login-widget-auth-design.md`. `users.org_id`/`email` are nullable and used only for the optional B2B overlay (Auth.js email/password + org accounts is deferred until that overlay is built).

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

**Auth flow (built so far — see `docs/superpowers/specs/2026-06-14-telegram-login-widget-auth-design.md`):**
- `src/auth.ts` configures NextAuth v5 (JWT sessions, `pages.signIn: "/login"`) with a single Credentials provider ("Telegram") whose `authorize()` runs `verifyTelegramAuth` (HMAC-SHA256 over the widget payload, keyed by `TELEGRAM_BOT_TOKEN`), then `TelegramAuthPayloadSchema.parse` + a `MAX_AUTH_AGE_SECONDS` freshness check, then `upsertTelegramUser` (upserts `users` by `telegramId`; creates an `organizations` row + links `orgId` on first login).
- `src/components/telegram-login-button.tsx` (`"use client"`) injects the `telegram-widget.js?22` script (`data-telegram-login={BOT_USERNAME}`, `data-onauth="onTelegramAuth(user)"`) and forwards the widget payload via `signIn("credentials", { ...credentials, redirect: false })`; on success it redirects to `/dashboard` (or `/dashboard?plan=<plan>`).
- `app/(gazar)/login` (server component, reads `?plan=` via `parsePlan`) redirects to `/dashboard` if `auth()` already has a session, otherwise renders `<TelegramLoginButton botUsername={env.BOT_USERNAME} plan={plan} />`.
- `app/(gazar)/dashboard` redirects to `/login` if unauthenticated; `app/admin/layout.tsx` redirects to `/login` unless `session.user.isAdmin` (derived from `ADMIN_TELEGRAM_IDS`).
- Session augmentation (`src/types/next-auth.d.ts`): `session.user.{id, telegramId, orgId, isAdmin}` / `jwt.{userId, telegramId, orgId, isAdmin}`.
- Landing page (`app/page.tsx`, a thin server component reading `env.BOT_USERNAME`) renders `<HomePageClient botUsername={...} />` (`app/home-page-client.tsx`): the hero "Эхлэх" CTA links to `/dashboard` if `useSession().status === "authenticated"` else `/login`; pricing card CTAs link to `/login?plan=tender|both|gazar`; the `#telegram` section embeds the real `<TelegramLoginButton>`.
- The old bot deep-link flow (`auth_tokens` table, `/api/telegram/webhook`, `lib/session.ts` HMAC cookie, `<LoginPoller>`) has been removed; migration 0006 drops `auth_tokens`. `docs/superpowers/specs/2026-06-13-telegram-auth-design.md` is superseded.
- TenderAlert has no `app/(tender)/` pages yet — `/login`, `/dashboard`, `/admin` exist at the app root / under `(gazar)` so far; the same session (gated by `users.id`, not by route group) will be reused once TenderAlert pages are built.
- The Telegram Login Widget requires the bot's domain to be registered via `@BotFather` (`/setdomain`) — not yet done against a real bot, so full OAuth click-through (the `signIn` → `authorize` → DB upsert path) remains a manual verification step.

**Tooling:**
- Never write `node ./node_modules/.bin/<bin>` in a `package.json` script — call the binary name directly (`tsc`, `eslint`, `next`, `tsx`, `turbo`, ...). pnpm puts workspace bins on `PATH`.
- `apps/platform/next.config.ts` sets `webpack.resolve.extensionAlias: { ".js": [".ts", ".tsx", ".js"] }`. Workspace packages (`@mn-platform/db`, etc.) are NodeNext/ESM and their relative imports use a `.js` extension that resolves to the sibling `.ts` source — without this alias, Next's webpack dev/build fails the first time any `apps/platform` route imports one of them (`Module not found: Can't resolve './client.js'`).

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
- [x] Crawlbase adapter swap — unegui-mn.ts and tender-gov-mn.ts fetchPage now call packages/core's fetchRenderedHtml (Crawlbase Crawling API, JS rendering) and parse the returned HTML with cheerio; getRateLimiter, Source shape, parseListing/parse, filter, and contentHash unchanged. New apps/worker/src/sources/selector-guard.ts (selectorPresent) backs checkListingContainer (unegui) and new checkRowContainer (tender), both now synchronous. tender-gov-mn's fetchedVia is "crawlbase"; TENDER_ADAPTER values renamed "playwright"|"api" -> "scrape"|"api" (default "scrape") in scheduler.ts. Removed: playwright dependency, apps/worker/src/sentry-filters.ts (+test) and its beforeSend wiring in instrument.ts, Dockerfile Chromium system-deps block. Added CRAWLBASE_TOKEN to env.ts/.env.example. Design: docs/superpowers/specs/2026-06-14-crawlbase-adapter-design.md. **Live selector verification (2026-06-14)** — both adapters rewritten against real rendered DOM via Playwright inspection: unegui-mn.ts `SEL = { CARD: ".advert.js-item-listing", PRICE: ".advert__content-price", TITLE: ".advert__content-title", PLACE: ".advert__content-place", NEXT_PAGE: ".number-list-next.js-page-filter" }`, externalId from the card's `data-id`, area/rooms parsed out of the title's free text (`AREA_RE`/`ROOMS_RE`), district/khoroo from `.advert__content-place`'s comma-separated parts; tender-gov-mn.ts `SEL.ROW = ".tender-result-table table tbody tr"` with `LIST_URL` = `.../mn/invitation?year=allYear&get=1` (the bare `/mn/invitation` page defaults to the server's current year and returns zero rows on this site — verified live), and since its pagination (`changePage()`) is AJAX-only, page ≥2 reuses the bare `LIST_URL` and `extractRows` skips the resulting "Тохирох үр дүн олдсонгүй" placeholder row. Also fixed `packages/mn/src/currency.ts` `parseMnt` to be case-insensitive for `сая`/`тэрбум` (was silently nulling prices written as capitalized "Тэрбум ₮", e.g. "1.07 Тэрбум ₮"). `pnpm typecheck`/`pnpm lint`/`pnpm test` all green (apps/worker 12 files / 78 tests). **Next concrete step:** items 3-5 of the live-run task (one manual scrape each of tender.gov.mn and unegui.mn sale to confirm DB rows, then activate both pg-boss schedules) are blocked on a real `CRAWLBASE_TOKEN` (paid third-party credential, cannot be fabricated) plus `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`/`SENTRY_DSN` in `.env` — `apps/worker/src/env.ts` eagerly Zod-parses `process.env` at import time, so the worker process cannot boot without all of these set.
- [ ] TenderAlert matching engine + saved profiles — keyword + category rules against a customer's saved profile (see Domain Glossary). Not yet started; the customer-facing alert pipeline above depends on this existing.
- [ ] QPay subscription flow
- [x] Landing page (`apps/platform/src/app/page.tsx`) — ported the Claude Design handoff `mn-platform-landing-page/project/МН Платформ Landing.dc.html` pixel-for-pixel into a `"use client"` React component. Wired up Tailwind v4 CSS-first config (`apps/platform/postcss.config.mjs`, `apps/platform/src/app/globals.css` with `@theme` tokens for the mn-* palette, `layout.tsx` loads Inter + JetBrains Mono with cyrillic+latin subsets). `page.module.css` holds the keyframes (`mnpulse`/`mnblink`/`mndraw`/`mnfloat`), the `.reveal`/`.revealed` scroll-in animation, and `:hover` rules with `!important` (needed to override the inline `style` colors ported from the prototype's `style-hover` attributes). Page covers nav, hero (live MM:SS countdown + SVG chart), stats, problem section, how-it-works (Тендер/Үл хөдлөх tab switcher), live data cards, pricing tiers, mock Telegram-login CTA, and footer, with an IntersectionObserver driving scroll-reveal. `pnpm typecheck`/`pnpm lint` green; verified visually against the dev server with Playwright across every section, both how-it-works tabs, and the Telegram login state toggle.
- [x] NextAuth v5 + Telegram Login Widget migration (supersedes the bot deep-link flow above) — design: `docs/superpowers/specs/2026-06-14-telegram-login-widget-auth-design.md`. Migration 0006 drops `auth_tokens` (applied to the live Neon DB). New: `src/lib/telegram-auth-schema.ts` (`verifyTelegramAuth`, `TelegramAuthPayloadSchema`, `MAX_AUTH_AGE_SECONDS`) + tests; `src/lib/upsert-telegram-user.ts` + tests (upsert `users` by `telegramId`, auto-create `organizations` + link `orgId` on first login); `src/auth.ts` (NextAuth Credentials provider) + `src/types/next-auth.d.ts` (session/jwt augmentation — requires `import type { JWT } from "next-auth/jwt"` alongside the `declare module` per Auth.js docs, else fields type as `unknown`) + `app/api/auth/[...nextauth]/route.ts`; `src/lib/plans.ts` (`Plan = "tender"|"gazar"|"both"`, `parsePlan`); `src/components/telegram-login-button.tsx` (shared, was under `app/(gazar)/login/`); `app/providers.tsx` (`SessionProvider`, wired into `layout.tsx`); rewrote `app/(gazar)/login` + `app/(gazar)/dashboard`, added `app/admin/{layout,page}.tsx` (admin gate via `isAdminTelegramId`/`ADMIN_TELEGRAM_IDS`). Removed: `lib/auth-tokens.ts`, `lib/session.ts`, `app/api/telegram/webhook/`, `app/(gazar)/login/{actions,login-poller}.tsx`. `apps/platform/tsconfig.json` gained `"composite": false, "declaration": false, "declarationMap": false` (fixes TS2742 "inferred type cannot be named" from next-auth v5 beta's `NextAuthResult` — apps/platform is a leaf `noEmit` app never consumed via TS project references). `env.test.ts` rewritten for `AUTH_SECRET`/`ADMIN_TELEGRAM_IDS`. `pnpm typecheck`/`pnpm lint`/tests (21/21) green across the monorepo.
- [x] Landing page wiring — split `app/page.tsx` into a thin server component (reads `env.BOT_USERNAME`) + `app/home-page-client.tsx` (`HomePageClient`, `"use client"`). Hero "Эхлэх — үнэгүй туршина уу" CTA → `/dashboard` if `useSession().status === "authenticated"` else `/login`; each `PRICING_TIERS` entry gained a `plan: Plan` field and `PricingCard`'s "Эхлэх" link → `/login?plan=${tier.plan}` (tender/both/gazar); the mock `#telegram` login button (and its dead `loggedIn` state, `ICON_TELEGRAM`, `.tgLoginBtn` CSS) was replaced with the real `<TelegramLoginButton botUsername={...} />`. Smooth scroll for "Хэрхэн ажилладаг вэ ↓" was already covered by `globals.css`'s `html { scroll-behavior: smooth; }`. Added `apps/platform/next.config.ts` `webpack.resolve.extensionAlias` fix (see Tooling) — without it the dev server 500s on any route that imports `@mn-platform/db` (first hit via `/api/auth/[...nextauth]`). Verified end-to-end with Playwright against `next dev`: `/` → `/login` (hero CTA, unauthenticated), `/` → `/login?plan=tender|both|gazar` (pricing cards), real Telegram Login Widget renders on `/` and `/login` (shows "Username invalid" — `BOT_USERNAME` is a local-dev placeholder, not yet registered via `@BotFather`), `/dashboard` → `/login` redirect when unauthenticated, and `#how` anchor scroll lands correctly under the sticky nav (`scrollMarginTop: 80`). **Next concrete step:** register a real bot with `@BotFather` (`/setdomain` for the deploy domain), set `BOT_USERNAME`/`TELEGRAM_BOT_TOKEN` for real, and re-verify the full `signIn` → `authorize` → `upsertTelegramUser` → `/dashboard` round trip with an authenticated session (including the hero CTA's authenticated branch).
