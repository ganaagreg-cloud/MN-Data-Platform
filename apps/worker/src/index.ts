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
