"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export default function LoginPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const botName = process.env["NEXT_PUBLIC_TELEGRAM_BOT_NAME"];
    if (!botName) {
      setError("Bot not configured. Set NEXT_PUBLIC_TELEGRAM_BOT_NAME.");
      return;
    }

    window.onTelegramAuth = async (user: TelegramWidgetUser) => {
      setLoading(true);
      setError(null);

      const result = await signIn("credentials", { ...user, redirect: false });

      if (!result?.ok) {
        setError(result?.error ?? "Verification failed. Please try again.");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    containerRef.current?.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [router]);

  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "4rem" }}>
      <h1>MN Data Platform</h1>
      <p>Sign in with your Telegram account to continue.</p>
      {error && (
        <p role="alert" style={{ color: "red" }}>
          {error}
        </p>
      )}
      {loading && <p>Signing in…</p>}
      <div ref={containerRef} />
    </main>
  );
}
