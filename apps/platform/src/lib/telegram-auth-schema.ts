// apps/platform/src/lib/telegram-auth-schema.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const TelegramAuthPayloadSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().min(1),
});

export type TelegramAuthPayload = z.infer<typeof TelegramAuthPayloadSchema>;

/**
 * Verifies the Telegram Login Widget's HMAC-SHA256 signature.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(
  raw: Record<string, string | undefined>,
  botToken: string,
): boolean {
  const { hash, ...rest } = raw;
  if (!hash) return false;

  const checkString = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(checkString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
