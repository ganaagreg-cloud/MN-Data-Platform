import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, subscriptions, eq } from "@mn-platform/db";
import { GazarFiltersForm } from "@/app/onboarding/wizard";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.orgId, session.user.orgId),
  });

  const hasGazar = subscription?.modules?.includes("gazar") ?? false;

  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>Тохиргоо</h1>

      {hasGazar ? (
        <>
          <p style={{ color: "#555", marginBottom: "2rem" }}>
            ГазарПрайс мэдэгдлийн шүүлтүүр — хоосон орхивол бүх зар хамрагдана.
          </p>
          <GazarFiltersForm
            existing={subscription?.gazarFilters ?? null}
            submitLabel="Хадгалах"
          />
        </>
      ) : (
        <p style={{ color: "#555" }}>
          Таны эрхэд ГазарПрайс модуль идэвхжээгүй байна.
        </p>
      )}
    </main>
  );
}
