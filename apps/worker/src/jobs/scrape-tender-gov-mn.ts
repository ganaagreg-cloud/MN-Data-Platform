import { runPipeline } from "@mn-platform/core";
import type { PipelineDb } from "@mn-platform/core";
import { tenderGovMnSource } from "../sources/tender-gov-mn.js";
import { logger } from "../logger.js";
import type { WorkerState } from "../types.js";

export function makeScrapeHandler(db: PipelineDb, state: WorkerState) {
  return async function handler([_job]: Array<unknown>) {
    const result = await runPipeline(tenderGovMnSource, db);
    state.lastRunAt = new Date();
    logger.info({ ...result, event: "scrape_complete" });
  };
}
