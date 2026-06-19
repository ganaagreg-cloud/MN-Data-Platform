"use client";

import { useState, useTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveEmail, saveModules, saveCategories, saveGazarFilters, saveTelegramChatId } from "./actions";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";
import type { GazarFilters } from "@mn-platform/db";

type ActionState = { error: string } | null;

const UB_DISTRICTS = [
  "Баянзүрх",
  "Сүхбаатар",
  "Чингэлтэй",
  "Хан-Уул",
  "Сонгинохайрхан",
  "Баянгол",
  "Налайх",
  "Багануур",
  "Багахангай",
];

interface WizardProps {
  initialStep: number;
  existingModules: string[];
  existingCategories: string[];
  existingGazarFilters: GazarFilters | null;
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

  const totalSteps = 4; // steps 1–4, step 0 (email) is pre-wizard

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4rem 1rem 0",
      }}
    >
      {step > 0 && step < 5 && (
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
        <GazarFiltersStep advance={advance} existing={props.existingGazarFilters} />
      )}
      {step === 4 && (
        <TelegramStep
          advance={advance}
          existingChatId={props.existingTelegramChatId}
          botUsername={props.botUsername}
        />
      )}
      {step === 5 && <DoneStep />}
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
          style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export function GazarFiltersForm({
  existing,
  onSaved,
  submitLabel = "Хадгалах",
}: {
  existing: GazarFilters | null;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [districts, setDistricts] = useState<Set<string>>(
    new Set(existing?.districts ?? []),
  );
  const [rooms, setRooms] = useState<Set<number>>(new Set(existing?.rooms ?? []));
  const [listingType, setListingType] = useState<"sale" | "rent" | "both">(
    existing?.listingTypes?.length === 1 ? existing.listingTypes[0]! : "both",
  );
  const [minPrice, setMinPrice] = useState(
    existing?.minPriceMnt != null ? String(existing.minPriceMnt) : "",
  );
  const [maxPrice, setMaxPrice] = useState(
    existing?.maxPriceMnt != null ? String(existing.maxPriceMnt) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleDistrict = (d: string) =>
    setDistricts((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const toggleRoom = (r: number) =>
    setRooms((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  const handleSave = () => {
    const fd = new FormData();
    districts.forEach((d) => fd.append("districts", d));
    rooms.forEach((r) => fd.append("rooms", String(r)));
    if (listingType !== "both") fd.append("listingTypes", listingType);
    if (minPrice.trim()) fd.set("minPriceMnt", minPrice.trim());
    if (maxPrice.trim()) fd.set("maxPriceMnt", maxPrice.trim());

    startTransition(async () => {
      const result = await saveGazarFilters(null, fd);
      if (result?.error) setError(result.error);
      else { setError(null); onSaved?.(); }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", width: "24rem" }}>
      {/* Listing type */}
      <div>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Зар төрөл</p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["both", "sale", "rent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setListingType(t)}
              style={{
                padding: "0.4rem 0.9rem",
                border: listingType === t ? "2px solid #0070f3" : "2px solid #ddd",
                borderRadius: "6px",
                background: listingType === t ? "#f0f7ff" : "white",
                cursor: "pointer",
                fontWeight: listingType === t ? "600" : "400",
                fontSize: "0.875rem",
              }}
            >
              {t === "both" ? "Аль аль нь" : t === "sale" ? "Зарна" : "Түрээс"}
            </button>
          ))}
        </div>
      </div>

      {/* Districts */}
      <div>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Дүүрэг <span style={{ fontWeight: 400, color: "#888" }}>(сонгоогүй бол бүх дүүрэг)</span>
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.35rem" }}>
          {UB_DISTRICTS.map((d) => (
            <label key={d} style={{ display: "flex", gap: "0.4rem", cursor: "pointer", fontSize: "0.875rem" }}>
              <input
                type="checkbox"
                checked={districts.has(d)}
                onChange={() => toggleDistrict(d)}
              />
              {d}
            </label>
          ))}
        </div>
      </div>

      {/* Rooms */}
      <div>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Өрөөний тоо <span style={{ fontWeight: 400, color: "#888" }}>(сонгоогүй бол бүх)</span>
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[1, 2, 3, 4].map((r) => (
            <label
              key={r}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={rooms.has(r)}
                onChange={() => toggleRoom(r)}
              />
              {r === 4 ? "4+" : r}
            </label>
          ))}
        </div>
      </div>

      {/* Price range */}
      <div>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Үнийн хязгаар (₮)</p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="number"
            placeholder="Доод үнэ"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            style={{ flex: 1, padding: "0.4rem", fontSize: "0.875rem" }}
          />
          <span style={{ color: "#888" }}>–</span>
          <input
            type="number"
            placeholder="Дээд үнэ"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            style={{ flex: 1, padding: "0.4rem", fontSize: "0.875rem" }}
          />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ color: "red", margin: 0, fontSize: "0.875rem" }}>
          {error}
        </p>
      )}

      <button type="button" onClick={handleSave} disabled={isPending}>
        {isPending ? "Хадгалж байна…" : submitLabel}
      </button>
    </div>
  );
}

function GazarFiltersStep({
  advance,
  existing,
}: {
  advance: (n: number) => void;
  existing: GazarFilters | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      <h1>ГазарПрайс шүүлтүүр</h1>
      <p style={{ color: "#555", textAlign: "center", maxWidth: "28rem" }}>
        Зөвхөн таны сонирхсон байрны мэдэгдэл илгээнэ.
        Бүх талбар заавал биш — хоосон орхивол бүх зар хамрагдана.
      </p>
      <GazarFiltersForm existing={existing} onSaved={() => advance(4)} submitLabel="Хадгалаад үргэлжлүүлэх" />
      <button
        type="button"
        onClick={() => advance(4)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "#888", marginTop: "-0.5rem" }}
      >
        Алгасах
      </button>
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
      else advance(5);
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
            onClick={() => advance(5)}
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
      <p style={{ color: "#555" }}>Your account is set up.</p>
      <button type="button" onClick={() => router.push("/dashboard")}>
        Go to Dashboard
      </button>
    </div>
  );
}
