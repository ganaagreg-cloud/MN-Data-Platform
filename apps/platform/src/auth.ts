// apps/platform/src/auth.ts
import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env, isAdminTelegramId } from "@/env";
import {
  MAX_AUTH_AGE_SECONDS,
  TelegramAuthPayloadSchema,
  verifyTelegramAuth,
} from "@/lib/telegram-auth-schema";
import { upsertTelegramUser } from "@/lib/upsert-telegram-user";

export const { handlers, signIn, signOut, auth }: NextAuthResult = NextAuth({
  session: { strategy: "jwt" },
  secret: env.AUTH_SECRET,
  pages: { signIn: "/login" },
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
          telegramId: user.telegramId as number,
          orgId: user.orgId as string,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        token.telegramId = user.telegramId;
        token.orgId = user.orgId;
      }
      token.isAdmin = isAdminTelegramId(token.telegramId);
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId;
      session.user.telegramId = token.telegramId;
      session.user.orgId = token.orgId;
      session.user.isAdmin = token.isAdmin;
      return session;
    },
  },
});
