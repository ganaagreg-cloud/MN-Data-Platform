import type { NextAuthConfig } from "next-auth";

// Edge-safe auth config — no Node.js-only imports (no node:crypto).
// Used by middleware; auth.ts extends this with the full Credentials provider.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  ...(process.env["AUTH_SECRET"] && { secret: process.env["AUTH_SECRET"] }),
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.userId = user.id;
        token.telegramId = (user as { telegramId: number }).telegramId;
        token.orgId = (user as { orgId: string }).orgId;
        token["email"] = (user as { email?: string | null }).email ?? null;
      }
      const adminIds = (process.env["ADMIN_TELEGRAM_IDS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      token.isAdmin = adminIds.includes(token.telegramId as number);
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
};
