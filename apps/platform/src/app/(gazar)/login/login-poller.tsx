// apps/platform/src/app/(gazar)/login/login-poller.tsx
"use client";

import { useEffect, useState } from "react";
import { checkLoginStatus } from "./actions";

const POLL_INTERVAL_MS = 2000;

export function LoginPoller({ token }: { token: string }) {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      void checkLoginStatus(token).then((status) => {
        if (status === "expired") {
          setExpired(true);
          clearInterval(interval);
        }
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [token]);

  if (expired) {
    return <p>Холбоосын хугацаа дууссан. Хуудсыг шинэчлээд дахин оролдоно уу.</p>;
  }

  return <p>Telegram-д баталгаажуулахыг хүлээж байна…</p>;
}
