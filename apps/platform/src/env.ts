// apps/platform/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Required by @mn-platform/db's client.ts (migrationDb) at import time,
  // even though apps/platform never runs migrations directly.
  DATABASE_URL_DIRECT: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Bare bot username, WITHOUT a leading "@" — used for the Login Widget's data-telegram-login attr.
  BOT_USERNAME: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  // Comma-separated Telegram numeric user IDs. Empty string = no admins.
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

const adminTelegramIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
);

export function isAdminTelegramId(telegramId: number | null | undefined): boolean {
  return telegramId != null && adminTelegramIds.has(telegramId);
}
