"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db, subscriptions } from "@mn-platform/db";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";

type ActionState = { error: string } | null;

export async function saveDashboardCategories(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData
    .getAll("categories")
    .filter((c): c is string => typeof c === "string");

  const validSet = new Set<string>(TENDER_CATEGORIES);
  const categories = raw.filter((c) => validSet.has(c));

  if (categories.length === 0) return { error: "Дор хаяж нэг ангилал сонго" };

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: ["tender"],
      categories,
      alertChannels: ["telegram", "email"],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { categories, updatedAt: new Date() },
    });

  revalidatePath("/dashboard");
  return null;
}
