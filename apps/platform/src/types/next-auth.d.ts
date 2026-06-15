// apps/platform/src/types/next-auth.d.ts
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      telegramId: number;
      orgId: string;
      isAdmin: boolean;
    };
  }

  interface User {
    telegramId: number;
    orgId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    telegramId: number;
    orgId: string;
    isAdmin: boolean;
  }
}
