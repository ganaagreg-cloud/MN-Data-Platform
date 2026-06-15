// apps/platform/src/lib/upsert-telegram-user.ts
import { eq } from "drizzle-orm";
import { db, organizations, users } from "@mn-platform/db";
import type { TelegramAuthPayload } from "./telegram-auth-schema";

export async function upsertTelegramUser(payload: TelegramAuthPayload) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        telegramId: payload.id,
        telegramUsername: payload.username ?? null,
        firstName: payload.first_name,
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          telegramUsername: payload.username ?? null,
          firstName: payload.first_name,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    if (!user) throw new Error("upsertTelegramUser: upsert returned no row");
    if (user.orgId) return user;

    const [org] = await tx
      .insert(organizations)
      .values({ name: `${payload.first_name}'s workspace` })
      .returning();
    if (!org) throw new Error("upsertTelegramUser: org insert returned no row");

    const [updated] = await tx
      .update(users)
      .set({ orgId: org.id })
      .where(eq(users.id, user.id))
      .returning();
    if (!updated) throw new Error("upsertTelegramUser: org-link update returned no row");

    return updated;
  });
}
