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
