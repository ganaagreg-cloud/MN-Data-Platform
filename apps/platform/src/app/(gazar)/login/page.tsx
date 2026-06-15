// apps/platform/src/app/(gazar)/login/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/env";
import { parsePlan } from "@/lib/plans";
import { TelegramLoginButton } from "@/components/telegram-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  const plan = parsePlan((await searchParams).plan);

  if (session) {
    redirect(plan ? `/dashboard?plan=${plan}` : "/dashboard");
  }

  return (
    <main>
      <h1>Нэвтрэх</h1>
      <p>Telegram ашиглан нэвтэрнэ үү.</p>
      <TelegramLoginButton botUsername={env.BOT_USERNAME} plan={plan} />
    </main>
  );
}
