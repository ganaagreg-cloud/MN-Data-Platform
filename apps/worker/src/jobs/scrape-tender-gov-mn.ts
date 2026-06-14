import PgBoss from "pg-boss";
import { runPipeline } from "@mn-platform/core";
import type { UpsertFn, TenderRecord } from "@mn-platform/core";
import { tenderGovMnSource } from "../sources/tender-gov-mn.js";
import { logger } from "../logger.js";
import type { WorkerState } from "../types.js";

export function makeScrapeHandler(upsertTender: UpsertFn<TenderRecord>, state: WorkerState) {
  return async function handler(_jobs: PgBoss.Job<unknown>[]) {
    const result = await runPipeline({ source: tenderGovMnSource, upsert: upsertTender });
    state.lastRunAt = new Date();
    logger.info({ ...result, event: "scrape_complete" });
  };
}
