import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/env";
import {
  MAX_AUTH_AGE_SECONDS,
  TelegramAuthPayloadSchema,
  verifyTelegramAuth,
} from "@/lib/telegram-auth-schema";
import { upsertTelegramUser } from "@/lib/upsert-telegram-user";
import { authConfig } from "@/auth.config";

export const { handlers, signIn, signOut, auth, unstable_update }: NextAuthResult = NextAuth({
  ...authConfig,
  secret: env.AUTH_SECRET,
  providers: [
    Credentials({
      name: "Telegram",
      credentials: {
        id: {},
        first_name: {},
        last_name: {},
        username: {},
        photo_url: {},
        auth_date: {},
        hash: {},
      },
      authorize: async (raw) => {
        const credentials = raw as Record<string, string | undefined>;
        if (!verifyTelegramAuth(credentials, env.TELEGRAM_BOT_TOKEN)) return null;

        const payload = TelegramAuthPayloadSchema.parse(credentials);
        if (Date.now() / 1000 - payload.auth_date > MAX_AUTH_AGE_SECONDS) return null;

        const user = await upsertTelegramUser(payload);
        return {
          id: user.id,
          name: user.firstName ?? user.telegramUsername ?? null,
          email: user.email ?? null,
          telegramId: user.telegramId as number,
          orgId: user.orgId as string,
        };
      },
    }),
  ],
});
