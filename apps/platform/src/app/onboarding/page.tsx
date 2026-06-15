"use client";

import { useActionState } from "react";
import { saveEmail } from "./actions";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState(saveEmail, null);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "4rem",
      }}
    >
      <h1>One more step</h1>
      <p>Enter your email to complete your account setup.</p>
      <form
        action={action}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "20rem" }}
      >
        <input
          type="email"
          name="email"
          required
          disabled={pending}
          placeholder="you@example.com"
          style={{ padding: "0.5rem", fontSize: "1rem" }}
        />
        {state?.error && (
          <p role="alert" style={{ color: "red", margin: 0 }}>
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
