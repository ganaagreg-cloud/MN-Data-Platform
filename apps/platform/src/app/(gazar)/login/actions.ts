// apps/platform/src/app/(gazar)/login/actions.ts
"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, authTokens, users } from "@mn-platform/db";
import { setSession } from "@/lib/session";

export type LoginStatus = "pending" | "expired";

export async function checkLoginStatus(token: string): Promise<LoginStatus> {
  const tokenRow = await db.query.authTokens.findFirst({ where: eq(authTokens.token, token) });

  if (!tokenRow || tokenRow.expiresAt < new Date()) return "expired";
  if (!tokenRow.consumed) return "pending";

  // Local const so the non-null narrowing survives the `await` below.
  const telegramId = tokenRow.telegramId;
  if (telegramId == null) return "pending";

  const user = await db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });
  if (!user) return "expired"; // shouldn't happen — webhook upserts before marking consumed

  await setSession(user.id);
  redirect("/dashboard");
}
