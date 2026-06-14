// apps/worker/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  SENTRY_DSN: z.string().url(),
  NODE_ENV: z.string().default("development"),
  GIT_SHA: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  CRAWLBASE_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Parsed eagerly on import so a missing/invalid SENTRY_DSN fails loudly at
// startup (via instrument.ts, which must be the first import) instead of
// Sentry silently no-oping for the rest of the process lifetime.
export const env: Env = envSchema.parse(process.env);
