// apps/platform/src/app/(gazar)/login/page.tsx
import { redirect } from "next/navigation";
import { db, authTokens } from "@mn-platform/db";
import { env } from "@/env";
import { getSession } from "@/lib/session";
import { AUTH_TOKEN_TTL_MS, generateAuthToken } from "@/lib/auth-tokens";
import { LoginPoller } from "./login-poller";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const token = generateAuthToken();
  await db.insert(authTokens).values({
    token,
    expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS),
  });

  const deepLink = `https://t.me/${env.BOT_USERNAME}?start=auth_${token}`;

  return (
    <main>
      <h1>Нэвтрэх</h1>
      <p>Telegram ашиглан нэвтэрнэ үү.</p>
      <a href={deepLink}>Telegram-ээр нэвтрэх</a>
      <LoginPoller token={token} />
    </main>
  );
}
