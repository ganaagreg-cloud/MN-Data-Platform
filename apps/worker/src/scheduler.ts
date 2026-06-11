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
  await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });

  // pg-boss v10 uses batchSize (jobs fetched per poll) instead of localConcurrency
  await boss.work(
    "scrape.tender-gov-mn",
    { batchSize: 2 },
    makeScrapeHandler(db, state),
  );

  // ── alert.dispatch ──────────────────────────────────────────────────────────
  // Stub — replaced by alert-pipeline plan
  await boss.work(
    "alert.dispatch",
    { batchSize: 5 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      logger.warn({ event: "alert_dispatch_stub" }, "alert.dispatch stub: not yet implemented");
    },
  );

  // ── export.generate ─────────────────────────────────────────────────────────
  await boss.work(
    "export.generate",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      logger.warn({ event: "export_generate_stub" }, "export.generate stub: not yet implemented");
    },
  );

  logger.info("all jobs registered");
}
