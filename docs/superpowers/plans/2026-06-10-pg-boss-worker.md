# pg-boss Worker Registration + Dockerfile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `apps/worker` into a production-ready auto-restarting process: pg-boss job registration, `/healthz` HTTP endpoint, and a Docker image with Chromium.

**Architecture:** A single `index.ts` boot sequence starts pg-boss, calls `registerJobs()` to schedule and wire all queue handlers, then starts a `node:http` health server. `db-adapter.ts` wraps Drizzle behind the `PipelineDb` interface so `packages/core` stays DB-agnostic.

**Tech Stack:** pg-boss ^10, pino, drizzle-orm/postgres-js, node:http, Vitest, Docker multi-stage build.

**Execute after:** No prerequisites — this is the foundational worker plan.

---

## File Map

| Action | Path |
|---|---|
| Create | `apps/worker/src/types.ts` |
| Create | `apps/worker/src/logger.ts` |
| Create | `apps/worker/src/db-adapter.ts` |
| Create | `apps/worker/src/jobs/scrape-tender-gov-mn.ts` |
| Create | `apps/worker/src/health.ts` |
| Create | `apps/worker/src/scheduler.ts` |
| Replace | `apps/worker/src/index.ts` |
| Create | `apps/worker/src/health.test.ts` |
| Create | `apps/worker/vitest.config.ts` |
| Modify | `apps/worker/package.json` |
| Create | `apps/worker/Dockerfile` |
| Create | `.dockerignore` |
| Create | `docker-compose.yml` |

---

### Task 1: Test infrastructure + shared types + logger

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/src/types.ts`
- Create: `apps/worker/src/logger.ts`

- [ ] **Step 1: Add vitest + test script to worker package.json**

Replace the `scripts` block and add `vitest` to `devDependencies` in `apps/worker/package.json`:

```json
{
  "name": "@mn-platform/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mn-platform/core": "workspace:*",
    "@mn-platform/db": "workspace:*",
    "@mn-platform/mn": "workspace:*",
    "pg-boss": "^10.0.0",
    "pino": "^10.3.1",
    "playwright": "^1.48.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.ts**

```ts
// apps/worker/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 3: Create src/types.ts**

```ts
// apps/worker/src/types.ts
export interface WorkerState {
  bossStarted: boolean;
  lastRunAt: Date | null;
}
```

- [ ] **Step 4: Create src/logger.ts**

```ts
// apps/worker/src/logger.ts
import pino from "pino";

export const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });
```

- [ ] **Step 5: Install vitest**

```bash
pnpm install
```

Expected: no errors, `vitest` appears in `apps/worker/node_modules/.bin/vitest`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/package.json apps/worker/vitest.config.ts apps/worker/src/types.ts apps/worker/src/logger.ts pnpm-lock.yaml
git commit -m "feat(worker): add vitest, WorkerState type, pino logger"
```

---

### Task 2: `db-adapter.ts` — PipelineDb wrapping Drizzle

**Files:**
- Create: `apps/worker/src/db-adapter.ts`

The pipeline calls `upsertTender(sourceId, contentHash, record)` and expects `"created" | "updated" | "unchanged"`. We do a select-first check to avoid a complex UPSERT with hash comparison.

- [ ] **Step 1: Create src/db-adapter.ts**

```ts
// apps/worker/src/db-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, tenders } from "@mn-platform/db";
import type { PipelineDb, UpsertOutcome, TenderRecord } from "@mn-platform/core";

export function createDbAdapter(): PipelineDb {
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
          raw:                 record.raw,
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
          raw:                 record.raw,
        })
        .where(eq(tenders.id, row.id));
      return "updated";
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/db-adapter.ts
git commit -m "feat(worker): add PipelineDb adapter wrapping Drizzle tenders upsert"
```

---

### Task 3: `jobs/scrape-tender-gov-mn.ts` — pg-boss job handler

**Files:**
- Create: `apps/worker/src/jobs/scrape-tender-gov-mn.ts`

- [ ] **Step 1: Create the handler factory**

```ts
// apps/worker/src/jobs/scrape-tender-gov-mn.ts
import { runPipeline } from "@mn-platform/core";
import type { PipelineDb } from "@mn-platform/core";
import { tenderGovMnSource } from "../sources/tender-gov-mn.js";
import { logger } from "../logger.js";
import type { WorkerState } from "../types.js";

export function makeScrapeHandler(db: PipelineDb, state: WorkerState) {
  return async function handler([_job]: [unknown]) {
    const result = await runPipeline(tenderGovMnSource, db);
    state.lastRunAt = new Date();
    logger.info({ ...result, event: "scrape_complete" });
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
git add apps/worker/src/jobs/scrape-tender-gov-mn.ts
git commit -m "feat(worker): add scrape-tender-gov-mn job handler"
```

---

### Task 4: `health.ts` — `/healthz` HTTP server

**Files:**
- Create: `apps/worker/src/health.ts`
- Create: `apps/worker/src/health.test.ts`

- [ ] **Step 1: Write the failing test first**

```ts
// apps/worker/src/health.test.ts
import { describe, it, expect } from "vitest";
import { buildHealthPayload } from "./health.js";

describe("buildHealthPayload", () => {
  it("returns degraded when boss has not started", () => {
    const result = buildHealthPayload(
      { bossStarted: false, lastRunAt: null },
      0,
    );
    expect(result.status).toBe("degraded");
    expect(result.lastRunAt).toBeNull();
    expect(result.failedJobCount).toBe(0);
  });

  it("returns ok when boss has started", () => {
    const date = new Date("2026-06-10T08:00:00.000Z");
    const result = buildHealthPayload(
      { bossStarted: true, lastRunAt: date },
      3,
    );
    expect(result.status).toBe("ok");
    expect(result.lastRunAt).toBe("2026-06-10T08:00:00.000Z");
    expect(result.failedJobCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `buildHealthPayload` not found.

- [ ] **Step 3: Implement health.ts**

```ts
// apps/worker/src/health.ts
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { db } from "@mn-platform/db";
import type { WorkerState } from "./types.js";
import { logger } from "./logger.js";

export interface HealthPayload {
  status: "ok" | "degraded";
  lastRunAt: string | null;
  failedJobCount: number;
}

export function buildHealthPayload(
  state: WorkerState,
  failedJobCount: number,
): HealthPayload {
  return {
    status: state.bossStarted ? "ok" : "degraded",
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    failedJobCount,
  };
}

async function queryFailedJobCount(): Promise<number> {
  try {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS count FROM pgboss.job WHERE state = 'failed'`,
    )) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  } catch {
    return -1;
  }
}

export function startHealthServer(
  state: WorkerState,
  port = parseInt(process.env["HEALTH_PORT"] ?? "9090", 10),
): void {
  const server = createServer(async (req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const failedJobCount = await queryFailedJobCount();
      const payload = buildHealthPayload(state, failedJobCount);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (err) {
      logger.error({ err }, "health server error");
      res.writeHead(503);
      res.end(JSON.stringify({ status: "error" }));
    }
  });

  server.listen(port);
  logger.info({ port }, "health server started");
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd apps/worker && pnpm test
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/health.ts apps/worker/src/health.test.ts
git commit -m "feat(worker): add /healthz HTTP server with buildHealthPayload"
```

---

### Task 5: `scheduler.ts` — register all pg-boss jobs

**Files:**
- Create: `apps/worker/src/scheduler.ts`

- [ ] **Step 1: Create scheduler.ts**

```ts
// apps/worker/src/scheduler.ts
import PgBoss from "pg-boss";
import type { PipelineDb } from "@mn-platform/core";
import { makeScrapeHandler } from "./jobs/scrape-tender-gov-mn.js";
import { logger } from "./logger.js";
import type { WorkerState } from "./types.js";

export async function registerJobs(
  boss: PgBoss,
  db: PipelineDb,
  state: WorkerState,
): Promise<void> {
  // ── scrape.tender-gov-mn ────────────────────────────────────────────────────
  await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", null, {
    tz: "Asia/Ulaanbaatar",
  });

  await boss.work(
    "scrape.tender-gov-mn",
    { localConcurrency: 2 },
    makeScrapeHandler(db, state),
  );

  // ── alert.dispatch ──────────────────────────────────────────────────────────
  // Stub — replaced by alert-pipeline plan
  await boss.work(
    "alert.dispatch",
    { localConcurrency: 5 },
    async ([_job]) => {
      logger.warn({ event: "alert_dispatch_stub" }, "alert.dispatch stub: not yet implemented");
    },
  );

  // ── export.generate ─────────────────────────────────────────────────────────
  await boss.work(
    "export.generate",
    { localConcurrency: 1 },
    async ([_job]) => {
      logger.warn({ event: "export_generate_stub" }, "export.generate stub: not yet implemented");
    },
  );

  logger.info("all jobs registered");
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/scheduler.ts
git commit -m "feat(worker): register pg-boss jobs — scraper every 2h, alert + export stubs"
```

---

### Task 6: `index.ts` — boot sequence

**Files:**
- Replace: `apps/worker/src/index.ts`

- [ ] **Step 1: Replace index.ts**

```ts
// apps/worker/src/index.ts
import PgBoss from "pg-boss";
import { createDbAdapter } from "./db-adapter.js";
import { registerJobs } from "./scheduler.js";
import { startHealthServer } from "./health.js";
import { logger } from "./logger.js";
import type { WorkerState } from "./types.js";

const state: WorkerState = {
  bossStarted: false,
  lastRunAt: null,
};

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL env var is required");

  const boss = new PgBoss(databaseUrl);

  boss.on("error", (err: Error) => {
    logger.error({ err }, "pg-boss error — exiting");
    process.exit(1);
  });

  await boss.start();
  state.bossStarted = true;
  logger.info("pg-boss started");

  const db = createDbAdapter();
  await registerJobs(boss, db, state);

  startHealthServer(state);

  const shutdown = async () => {
    logger.info("SIGTERM/SIGINT received — shutting down");
    await boss.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.info("worker ready");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/worker && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run tests to confirm nothing regressed**

```bash
cd apps/worker && pnpm test
```

Expected: 2 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): wire pg-boss boot sequence with graceful shutdown"
```

---

### Task 7: Dockerfile + `.dockerignore` + `docker-compose.yml`

**Files:**
- Create: `apps/worker/Dockerfile`
- Create: `.dockerignore` (repo root)
- Create: `docker-compose.yml` (repo root)

- [ ] **Step 1: Create apps/worker/Dockerfile**

```dockerfile
# apps/worker/Dockerfile

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

COPY --from=builder /app .

# Playwright + Chromium system deps must be in the runner image, not the builder,
# so the final layer contains all required shared libraries.
RUN npx playwright install --with-deps chromium

EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]
```

- [ ] **Step 2: Create .dockerignore at repo root**

```
node_modules
**/node_modules
**/dist
**/.turbo
.git
.env
.env.*
```

- [ ] **Step 3: Create docker-compose.yml at repo root**

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

- [ ] **Step 4: Verify Dockerfile build (requires Docker)**

```bash
docker build -f apps/worker/Dockerfile . -t mn-worker:local
```

Expected: build completes without errors; `mn-worker:local` image exists.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/Dockerfile .dockerignore docker-compose.yml
git commit -m "feat(worker): add multi-stage Dockerfile, .dockerignore, docker-compose.yml"
```

---

### Task 8: Final typecheck + lint

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck
```

Expected: all 5 packages exit 0.

- [ ] **Step 2: Full lint**

```bash
pnpm lint
```

Expected: exits 0.

- [ ] **Step 3: Run all tests**

```bash
cd apps/worker && pnpm test
```

Expected: 2 tests passing.

- [ ] **Step 4: Commit if any lint auto-fixes were applied**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore(worker): apply lint fixes"
```
