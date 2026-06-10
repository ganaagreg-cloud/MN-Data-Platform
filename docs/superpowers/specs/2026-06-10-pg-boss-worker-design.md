# pg-boss Worker Registration + Dockerfile

**Date:** 2026-06-10
**Status:** Approved

## Goal

Wire `apps/worker` into a production-ready, auto-restarting process:

1. Register all scrape jobs (and stubs for alert dispatch + exports) with pg-boss using controlled concurrency.
2. Expose a `/healthz` HTTP endpoint returning `{status, lastRunAt, failedJobCount}`.
3. Package the worker in a Dockerfile with a Chromium-capable runtime and a `HEALTHCHECK` directive. A `docker-compose.yml` at the repo root adds `restart: always`.

---

## File Layout

```
apps/worker/src/
  index.ts                       ← boot: start pg-boss, register all jobs, start health server
  scheduler.ts                   ← all boss.schedule() + boss.work() calls
  db-adapter.ts                  ← PipelineDb implementation wrapping Drizzle upsertTender
  jobs/
    scrape-tender-gov-mn.ts      ← handler: runPipeline(tenderGovMnSource, db) + update lastRunAt
  health.ts                      ← node:http server — GET /healthz
apps/worker/Dockerfile
docker-compose.yml               ← repo root; restart: always
```

---

## Queues, Concurrency, and Schedules

| Queue | `localConcurrency` | Cron | Timezone |
|---|---|---|---|
| `scrape.tender-gov-mn` | 2 | `0 */2 * * *` | `Asia/Ulaanbaatar` |
| `alert.dispatch` | 5 | — (enqueued by pipeline) | — |
| `export.generate` | 1 | — (enqueued on demand) | — |

- `boss.schedule(name, cron, null, { tz })` registers the cron trigger in Postgres.
- `boss.work(name, { localConcurrency: N }, handler)` registers the handler (verified against pg-boss v10 docs).
- Alert and export queues register their workers on startup as stubs (`async ([_job]) => { /* TODO */ }`), so the concurrency limit and queue exist before the implementations land.

---

## Component Details

### `db-adapter.ts`

Implements `PipelineDb` from `@mn-platform/core` by calling Drizzle's `insert(...).onConflictDoUpdate(...)` on the `tenders` table. Returns `"created"`, `"updated"`, or `"unchanged"` based on whether `content_hash` changed.

### `scheduler.ts`

Exported function `registerJobs(boss: PgBoss, db: PipelineDb, state: WorkerState)`:

1. Calls `boss.schedule('scrape.tender-gov-mn', '0 */2 * * *', null, { tz: 'Asia/Ulaanbaatar' })`.
2. Calls `boss.work('scrape.tender-gov-mn', { localConcurrency: 2 }, scrapeHandler)`.
3. Calls `boss.work('alert.dispatch', { localConcurrency: 5 }, alertStub)`.
4. Calls `boss.work('export.generate', { localConcurrency: 1 }, exportStub)`.

### `jobs/scrape-tender-gov-mn.ts`

```ts
async ([job]) => {
  const result = await runPipeline(tenderGovMnSource, db);
  state.lastRunAt = new Date();
  logger.info({ ...result, event: 'scrape_complete' });
}
```

Errors thrown from the handler are caught by pg-boss and the job is marked `failed` — no extra try/catch needed at the handler level.

### `health.ts`

`node:http` server, no external dependencies. `PORT` env var (default `9090`).

`GET /healthz` response:

```json
{
  "status": "ok",
  "lastRunAt": "2026-06-10T08:00:00.000Z",
  "failedJobCount": 3
}
```

- `status`: `"ok"` when `state.bossStarted === true`; `"degraded"` otherwise.
- `lastRunAt`: `state.lastRunAt?.toISOString() ?? null` — updated by each job handler on success.
- `failedJobCount`: live query `SELECT count(*)::int FROM pgboss.job WHERE state = 'failed'` via Drizzle `sql\`\``.

Any path other than `/healthz` returns `404`.

### `index.ts`

Boot sequence:

1. Instantiate `PgBoss(DATABASE_URL)`.
2. `boss.on('error', ...)` → log and exit.
3. `await boss.start()` → set `state.bossStarted = true`.
4. `registerJobs(boss, db, state)`.
5. `startHealthServer(state)`.
6. Graceful shutdown on `SIGTERM`/`SIGINT`: `await boss.stop()`.

### `WorkerState`

Shared mutable object threaded through scheduler and health server:

```ts
interface WorkerState {
  bossStarted: boolean;
  lastRunAt: Date | null;
}
```

---

## Dockerfile

Two stages. The fix from design review: `playwright install --with-deps chromium` runs in **Stage 2 (runner)**, not the builder, so Chromium's system dependencies land in the final image.

```dockerfile
# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# Copy built artefacts and installed node_modules from builder
COPY --from=builder /app .

# Install Chromium + system deps for Playwright (must be in runner)
RUN npx playwright install --with-deps chromium

EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]
```

`node -e` is used for the health check (avoids needing `curl` in the slim image).

---

## .dockerignore (repo root)

Required to prevent host `node_modules` and build artefacts from bloating the Docker build context:

```
node_modules
**/node_modules
**/dist
**/.turbo
.git
.env
.env.*
```

---

## docker-compose.yml (repo root)

```yaml
services:
  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    restart: always
    env_file: .env
    ports:
      - "9090:9090"
```

`DATABASE_URL` and `DATABASE_URL_DIRECT` are supplied via `.env`.

---

## Error Handling

- **pg-boss `error` event** → `pino` logs the error; process exits so the container restarts via `restart: always`.
- **Per-job errors** → pg-boss marks the job `failed` after exhausting retries. The failed count surfaces in `/healthz`. No process crash.
- **Health server errors** → logged; health server failure does not crash the worker process.

---

## Definition of Done

All gates from `CLAUDE.md` must pass before marking implementation complete:

- [ ] `pnpm typecheck` passes — no `any`.
- [ ] `pnpm lint` passes.
- [ ] Scrape job is idempotent (re-running produces no duplicates, no double-alerts).
- [ ] All external input validated with Zod (existing `TenderRecordSchema`).
- [ ] No secrets in code or committed files.
- [ ] Dockerfile builds successfully (`docker build -f apps/worker/Dockerfile .`).
- [ ] `/healthz` returns `200` with the correct shape when the container is running.
