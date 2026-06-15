"use client";

import { useState, useTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveEmail, saveModules, saveCategories, saveTelegramChatId } from "./actions";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";

type ActionState = { error: string } | null;

interface WizardProps {
  initialStep: number;
  existingModules: string[];
  existingCategories: string[];
  existingTelegramChatId: string | null;
  botUsername: string | null;
}

export function OnboardingWizard(props: WizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(props.initialStep);

  const advance = (n: number) => {
    setStep(n);
    router.push(`/onboarding?step=${n}`, { scroll: false });
  };

  const totalSteps = 3; // steps 1–3, step 0 (email) is pre-wizard

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "4rem",
        padding: "4rem 1rem 0",
      }}
    >
      {step > 0 && step < 4 && (
        <p style={{ color: "#888", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
          Step {step} of {totalSteps}
        </p>
      )}
      {step === 0 && <EmailStep />}
      {step === 1 && (
        <ModuleStep advance={advance} existingModules={props.existingModules} />
      )}
      {step === 2 && (
        <CategoryStep advance={advance} existingCategories={props.existingCategories} />
      )}
      {step === 3 && (
        <TelegramStep
          advance={advance}
          existingChatId={props.existingTelegramChatId}
          botUsername={props.botUsername}
        />
      )}
      {step === 4 && <DoneStep />}
    </main>
  );
}

function EmailStep() {
  const [state, action, pending] = useActionState(saveEmail, null);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
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
    </div>
  );
}

function ModuleStep({
  advance,
  existingModules,
}: {
  advance: (n: number) => void;
  existingModules: string[];
}) {
  const initialValue =
    existingModules.includes("tender") && existingModules.includes("gazar")
      ? "both"
      : existingModules[0] ?? "";
  const [selected, setSelected] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    const modules =
      selected === "both" ? ["tender", "gazar"] : selected ? [selected] : [];
    const fd = new FormData();
    modules.forEach((m) => fd.append("modules", m));
    startTransition(async () => {
      const result = await saveModules(null, fd);
      if (result?.error) setError(result.error);
      else advance(2);
    });
  };

  const options = [
    { value: "tender", label: "Тендер" },
    { value: "gazar", label: "ГазарПрайс" },
    { value: "both", label: "Хоёулаа" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <h1>Та юу хянахыг хүсч байна вэ?</h1>
      <p style={{ color: "#555" }}>Choose the products you want access to.</p>
      <div style={{ display: "flex", gap: "1rem", margin: "1.5rem 0" }}>
        {options.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSelected(value)}
            style={{
              padding: "1rem 1.5rem",
              border: selected === value ? "2px solid #0070f3" : "2px solid #ddd",
              borderRadius: "8px",
              background: selected === value ? "#f0f7ff" : "white",
              cursor: "pointer",
              fontWeight: selected === value ? "600" : "400",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ color: "red", marginBottom: "0.5rem" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button type="button" onClick={handleSave} disabled={isPending || !selected}>
          {isPending ? "Saving…" : "Save & Continue"}
        </button>
        <button
          type="button"
          onClick={() => advance(2)}
          disabled={isPending}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function CategoryStep({
  advance,
  existingCategories,
}: {
  advance: (n: number) => void;
  existingCategories: string[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(existingCategories));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (cat: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const handleSave = () => {
    const fd = new FormData();
    checked.forEach((c) => fd.append("categories", c));
    startTransition(async () => {
      const result = await saveCategories(null, fd);
      if (result?.error) setError(result.error);
      else advance(3);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <h1>Ямар ангиллын тендер сонирхож байна вэ?</h1>
      <p style={{ color: "#555" }}>Select categories to receive alerts for. Leave blank to match all.</p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          margin: "1.5rem 0",
          width: "20rem",
        }}
      >
        {TENDER_CATEGORIES.map((cat) => (
          <label key={cat} style={{ display: "flex", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked.has(cat)}
              onChange={() => toggle(cat)}
            />
            {cat}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ color: "red", marginBottom: "0.5rem" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button type="button" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save & Continue"}
        </button>
        <button
          type="button"
          onClick={() => advance(3)}
          disabled={isPending}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function TelegramStep({
  advance,
  existingChatId,
  botUsername,
}: {
  advance: (n: number) => void;
  existingChatId: string | null;
  botUsername: string | null;
}) {
  const [chatId, setChatId] = useState(existingChatId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    const fd = new FormData();
    fd.set("chatId", chatId);
    startTransition(async () => {
      const result = await saveTelegramChatId(null, fd);
      if (result?.error) setError(result.error);
      else advance(4);
    });
  };

  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=link`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <h1>Telegram холболт</h1>
      <p style={{ color: "#555", textAlign: "center", maxWidth: "24rem" }}>
        Link a Telegram chat to receive alerts. You can use a personal chat or a group.
      </p>
      {deepLink ? (
        <p style={{ margin: "1rem 0" }}>
          1.{" "}
          <a href={deepLink} target="_blank" rel="noopener noreferrer">
            Add our bot
          </a>{" "}
          and send <code>/start</code>.
          <br />
          2. The bot will reply with your chat ID.
        </p>
      ) : (
        <p style={{ color: "#f59e0b", margin: "1rem 0" }}>
          Bot username not configured — contact the admin to set TELEGRAM_BOT_USERNAME.
        </p>
      )}
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "20rem" }}
      >
        <input
          type="text"
          placeholder="Chat ID (e.g. 123456789 or -1001234567890)"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          disabled={isPending}
          style={{ padding: "0.5rem", fontSize: "1rem" }}
        />
        {error && (
          <p role="alert" style={{ color: "red", margin: 0 }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="button" onClick={handleSave} disabled={isPending || !chatId.trim()}>
            {isPending ? "Saving…" : "Save & Continue"}
          </button>
          <button
            type="button"
            onClick={() => advance(4)}
            disabled={isPending}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function DoneStep() {
  const router = useRouter();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      <h1>Бэлэн боллоо!</h1>
      <p style={{ color: "#555" }}>Your account is set up. You can update these settings later.</p>
      <button type="button" onClick={() => router.push("/dashboard")}>
        Go to Dashboard
      </button>
    </div>
  );
}
