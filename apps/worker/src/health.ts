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
