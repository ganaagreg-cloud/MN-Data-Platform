// apps/platform/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Required by @mn-platform/db's client.ts (migrationDb) at import time,
  // even though apps/platform never runs migrations directly.
  DATABASE_URL_DIRECT: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Bare bot username, WITHOUT a leading "@" — used to build t.me/{BOT_USERNAME}?start=...
  BOT_USERNAME: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
