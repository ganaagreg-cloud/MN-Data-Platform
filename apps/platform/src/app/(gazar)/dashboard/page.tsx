// apps/platform/src/app/(gazar)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users } from "@mn-platform/db";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });

  return (
    <main>
      <h1>Тавтай морил, {user?.firstName ?? user?.telegramUsername ?? "хэрэглэгч"}!</h1>
    </main>
  );
}
