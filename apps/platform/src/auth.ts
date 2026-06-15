import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, eq, organizations, users } from "@mn-platform/db";
import { verifyTelegramPayload } from "@/lib/telegram-auth";

declare module "next-auth" {
  interface User {
    telegramId: number;
    orgId: string;
  }
  interface Session {
    user: {
      id: string;
      telegramId: number;
      name: string | null;
      email: string | null;
      orgId: string;
    };
  }
}

const _auth: NextAuthResult = NextAuth({
  providers: [
    Credentials({
      credentials: {
        id: { type: "text" },
        first_name: { type: "text" },
        last_name: { type: "text" },
        username: { type: "text" },
        photo_url: { type: "text" },
        auth_date: { type: "text" },
        hash: { type: "text" },
      },
      async authorize(credentials) {
        const botToken = process.env["TELEGRAM_BOT_TOKEN"];
        if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not configured");

        const tgUser = verifyTelegramPayload(credentials, botToken);

        const existing = await db.query.users.findFirst({
          where: eq(users.telegramId, tgUser.id),
        });

        if (!existing) {
          const [org] = await db
            .insert(organizations)
            .values({ name: `${tgUser.first_name}'s workspace` })
            .returning();
          if (!org) throw new Error("Failed to create organization");

          const [user] = await db
            .insert(users)
            .values({
              telegramId: tgUser.id,
              orgId: org.id,
              name: tgUser.first_name,
              telegramUsername: tgUser.username ?? null,
              lastLoginAt: new Date(),
            })
            .returning();
          if (!user) throw new Error("Failed to create user");

          return {
            id: user.id,
            telegramId: user.telegramId!,
            name: user.name,
            email: user.email,
            orgId: user.orgId,
          };
        }

        const [user] = await db
          .update(users)
          .set({
            name: tgUser.first_name,
            telegramUsername: tgUser.username ?? null,
            lastLoginAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();
        if (!user) throw new Error("Failed to update user");

        return {
          id: user.id,
          telegramId: user.telegramId!,
          name: user.name,
          email: user.email,
          orgId: user.orgId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        const u = user as { telegramId: number; orgId: string; email?: string | null };
        token["telegramId"] = u.telegramId;
        token["orgId"] = u.orgId;
        token["email"] = u.email ?? null;
      }
      const triggerSession = session as { user?: { email?: string } } | null;
      if (trigger === "update" && triggerSession?.user?.email) {
        token["email"] = triggerSession.user.email;
      }
      return token;
    },
    session({ session, token }) {
      // Cast session.user to our augmented shape to assign all custom fields.
      const u = session.user as unknown as {
        id: string;
        telegramId: number;
        name: string | null;
        email: string | null;
        orgId: string;
      };
      u.id = token.sub!;
      u.telegramId = token["telegramId"] as number;
      u.orgId = token["orgId"] as string;
      u.email = (token["email"] as string | null | undefined) ?? null;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "jwt" },
});

export const handlers: NextAuthResult["handlers"] = _auth.handlers;
export const auth: NextAuthResult["auth"] = _auth.auth;
export const signIn: NextAuthResult["signIn"] = _auth.signIn;
export const signOut: NextAuthResult["signOut"] = _auth.signOut;
export const unstable_update: NextAuthResult["unstable_update"] = _auth.unstable_update;
