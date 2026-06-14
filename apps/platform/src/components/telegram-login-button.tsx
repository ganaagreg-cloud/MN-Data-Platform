// apps/platform/src/components/telegram-login-button.tsx
"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import type { Plan } from "@/lib/plans";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

export function TelegramLoginButton({
  botUsername,
  plan,
}: {
  botUsername: string;
  plan?: Plan | undefined;
}) {
  const [error, setError] = useState(false);

  useEffect(() => {
    window.onTelegramAuth = (user) => {
      const credentials = Object.fromEntries(
        Object.entries(user).map(([k, v]) => [k, String(v)]),
      );
      void signIn("credentials", { ...credentials, redirect: false }).then((res) => {
        if (res?.ok) {
          window.location.href = plan ? `/dashboard?plan=${plan}` : "/dashboard";
        } else {
          setError(true);
        }
      });
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    document.getElementById("telegram-login-container")?.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername, plan]);

  return (
    <div>
      <div id="telegram-login-container" />
      {error && <p>Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.</p>}
    </div>
  );
}
