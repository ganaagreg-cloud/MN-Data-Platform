import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env, isAdminTelegramId } from "@/env";
import {
  MAX_AUTH_AGE_SECONDS,
  TelegramAuthPayloadSchema,
  verifyTelegramAuth,
} from "@/lib/telegram-auth-schema";
import { upsertTelegramUser } from "@/lib/upsert-telegram-user";

export const { handlers, signIn, signOut, auth, unstable_update }: NextAuthResult = NextAuth({
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
          email: user.email ?? null,
          telegramId: user.telegramId as number,
          orgId: user.orgId as string,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.userId = user.id;
        token.telegramId = (user as { telegramId: number }).telegramId;
        token.orgId = (user as { orgId: string }).orgId;
        token["email"] = (user as { email?: string | null }).email ?? null;
      }
      token.isAdmin = isAdminTelegramId(token.telegramId as number);
      const triggerSession = session as { user?: { email?: string } } | null;
      if (trigger === "update" && triggerSession?.user?.email) {
        token["email"] = triggerSession.user.email;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.telegramId = token.telegramId as number;
      session.user.orgId = token.orgId as string;
      session.user.isAdmin = token.isAdmin as boolean;
      const userWithEmail = session.user as { email?: string | null };
      userWithEmail.email = (token["email"] as string | null | undefined) ?? null;
      return session;
    },
  },
});
