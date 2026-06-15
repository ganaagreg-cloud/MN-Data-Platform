"use server";

import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { db, users, eq } from "@mn-platform/db";

type ActionState = { error: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function completeEmail(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const email = ((formData.get("email") as string | null) ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) {
    return { error: "Please enter a valid email address" };
  }

  const conflict = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (conflict && conflict.id !== session.user.id) {
    return { error: "That email is already in use" };
  }

  await db.update(users).set({ email }).where(eq(users.id, session.user.id));

  // Refresh the JWT cookie so middleware sees email != null on the next request.
  await unstable_update({ user: { email } });

  redirect("/dashboard");
}
