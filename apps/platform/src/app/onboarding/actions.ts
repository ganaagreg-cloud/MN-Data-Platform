"use server";

import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { db, users, subscriptions, eq } from "@mn-platform/db";
import { parseChatId } from "@/lib/parse-chat-id";

type ActionState = { error: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveEmail(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.get("email");
  const email = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { error: "Please enter a valid email address" };
  }

  const conflict = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (conflict && conflict.id !== session.user.id) {
    return { error: "That email is already in use" };
  }

  try {
    await db.update(users).set({ email }).where(eq(users.id, session.user.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("23505") || msg.includes("users_email_idx")) {
      return { error: "That email is already in use" };
    }
    throw err;
  }

  await unstable_update({ user: { email } });
  redirect("/onboarding?step=1");
}

export async function saveModules(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.getAll("modules").filter((m): m is string => typeof m === "string");
  const valid = raw.every((m) => m === "tender" || m === "gazar");
  if (!valid) return { error: "Invalid module selection" };

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: raw,
      categories: [],
      alertChannels: [],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { modules: raw, updatedAt: new Date() },
    });

  return null;
}

export async function saveCategories(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const categories = formData
    .getAll("categories")
    .filter((c): c is string => typeof c === "string");

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: [],
      categories,
      alertChannels: [],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { categories, updatedAt: new Date() },
    });

  return null;
}

export async function saveTelegramChatId(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.get("chatId");
  const result = parseChatId(typeof raw === "string" ? raw : "");
  if (!result.ok) return { error: result.error };

  await db
    .update(users)
    .set({ telegramChatId: result.value })
    .where(eq(users.id, session.user.id));

  return null;
}
