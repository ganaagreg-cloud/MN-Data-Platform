// apps/platform/src/app/(gazar)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main>
      <h1>Тавтай морил, {session.user.name ?? "хэрэглэгч"}!</h1>
    </main>
  );
}
