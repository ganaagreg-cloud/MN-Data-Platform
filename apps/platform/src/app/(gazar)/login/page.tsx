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
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Нэвтрэх</h1>
          <p className="text-gray-500 text-sm">Telegram ашиглан нэвтэрнэ үү.</p>
        </div>
        <TelegramLoginButton botUsername={env.BOT_USERNAME} plan={plan} />
      </div>
    </main>
  );
}
