// apps/worker/src/scheduler.ts
import PgBoss from "pg-boss";
import { runPipeline } from "@mn-platform/core";
import type { PipelineDb, Source, TenderRecord } from "@mn-platform/core";
import { tenderGovMnSource } from "./sources/tender-gov-mn.js";
import { openDataTenderSource } from "./sources/opendata-tender-gov-mn.js";
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
  db: PipelineDb,
  state: WorkerState,
): Promise<void> {
  // ── scrape.tender-gov-mn ────────────────────────────────────────────────────
  // Validate at startup — throws immediately if TENDER_ADAPTER is misconfigured.
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
      const result = await runPipeline(tenderSource, db);
      state.lastRunAt = new Date();
      logger.info({ ...result, adapter, event: "scrape_complete" });
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
