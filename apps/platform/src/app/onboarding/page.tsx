import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, subscriptions, users, eq } from "@mn-platform/db";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const requestedStep = Math.min(5, Math.max(0, Math.floor(Number(params.step ?? 0) || 0)));

  // Auto-advance past email step if email is already set
  const effectiveStep = session.user.email ? Math.max(requestedStep, 1) : requestedStep;
  if (effectiveStep !== requestedStep) {
    redirect(`/onboarding?step=${effectiveStep}`);
  }

  const [subscription, user] = await Promise.all([
    db.query.subscriptions.findFirst({ where: eq(subscriptions.orgId, session.user.orgId) }),
    db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
  ]);

  const modules = subscription?.modules ?? [];

  // Skip categories step (2) if tender is not selected
  if (effectiveStep === 2 && !modules.includes("tender")) {
    redirect("/onboarding?step=3");
  }

  // Skip gazar filters step (3) if gazar is not selected
  if (effectiveStep === 3 && !modules.includes("gazar")) {
    redirect("/onboarding?step=4");
  }

  return (
    <OnboardingWizard
      initialStep={effectiveStep}
      existingModules={modules}
      existingCategories={subscription?.categories ?? []}
      existingGazarFilters={subscription?.gazarFilters ?? null}
      existingTelegramChatId={user?.telegramChatId ?? null}
      botUsername={process.env["TELEGRAM_BOT_USERNAME"] ?? null}
    />
  );
}
