import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Pooled — for all app (Next.js routes) and worker queries.
// Neon's pooler runs PgBouncer in transaction mode; prepared statements must be off.
const pooledSql = postgres(requireEnv("DATABASE_URL"), { prepare: false });
export const db = drizzle(pooledSql, { schema });

// Direct — for programmatic migration scripts only.
// drizzle-kit uses DATABASE_URL_DIRECT via drizzle.config.ts independently.
const directSql = postgres(requireEnv("DATABASE_URL_DIRECT"));
export const migrationDb = drizzle(directSql, { schema });
