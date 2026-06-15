# Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-step email-collection page at `/onboarding` with a 5-step wizard (email → module → categories → Telegram → done) so new users leave onboarding with their subscription and alert preferences configured.

**Architecture:** Single `/onboarding` route; step tracked in `?step=N` URL param. A server component (`page.tsx`) fetches current DB state and passes it as props to a client component (`wizard.tsx`) that owns rendering and navigation. Server actions in `actions.ts` handle each save; the client advances the URL on success.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, next-auth JWT, Vitest, TypeScript strict

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/db/src/schema/index.ts` | Modify | Add `categories text[]` to subscriptions; make org_id uniqueIndex |
| `packages/db/migrations/0005_*.sql` | Generate | ADD COLUMN + DROP old index + CREATE UNIQUE INDEX |
| `apps/platform/src/lib/tender-categories.ts` | Create | `TENDER_CATEGORIES` constant |
| `apps/platform/src/lib/parse-chat-id.ts` | Create | Pure validator for Telegram chat IDs |
| `apps/platform/src/auth.ts` | Modify | Insert subscription row on first user creation |
| `apps/platform/src/app/onboarding/actions.ts` | Modify | Change email redirect; add saveModules, saveCategories, saveTelegramChatId |
| `apps/platform/src/app/onboarding/wizard.tsx` | Create | Client component — all step UIs and navigation |
| `apps/platform/src/app/onboarding/page.tsx` | Modify | Server component — fetch, redirect logic, render wizard |

---

## Task 1: DB schema — add categories column and unique index on org_id

**Files:**
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1.1: Update the subscriptions table definition**

In `packages/db/src/schema/index.ts`, replace the subscriptions table with:

```ts
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id)
      .notNull(),
    modules: text("modules").array().notNull().default([]),
    categories: text("categories").array().notNull().default([]),
    alertChannels: text("alert_channels").array().notNull().default([]),
    status: text("status").notNull().default("trial"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_org_id_idx").on(t.orgId),
    index("subscriptions_status_idx").on(t.status),
  ],
);
```

Two changes: `categories` column added between `modules` and `alertChannels`; `index` changed to `uniqueIndex` on `org_id` (needed for `onConflictDoUpdate` in actions).

- [ ] **Step 1.2: Generate the migration**

```bash
cd packages/db && pnpm db:generate
```

Expected: a new file `packages/db/migrations/0005_*.sql` is created. Inspect it — it should contain `ADD COLUMN "categories"`, a `DROP INDEX`, and a `CREATE UNIQUE INDEX`.

- [ ] **Step 1.3: Apply the migration**

```bash
pnpm --filter @mn-platform/db db:migrate
```

Expected: "All migrations applied successfully" (or similar). Requires `DATABASE_URL_DIRECT` set in `.env`.

- [ ] **Step 1.4: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 1.5: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(db): add subscriptions.categories column, unique index on org_id"
```

---

## Task 2: Tender categories constant + test

**Files:**
- Create: `apps/platform/src/lib/tender-categories.ts`
- Create: `apps/platform/src/lib/tender-categories.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `apps/platform/src/lib/tender-categories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TENDER_CATEGORIES } from "./tender-categories";

describe("TENDER_CATEGORIES", () => {
  it("is a non-empty array of strings", () => {
    expect(TENDER_CATEGORIES.length).toBeGreaterThan(0);
    for (const cat of TENDER_CATEGORIES) {
      expect(typeof cat).toBe("string");
      expect(cat.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(TENDER_CATEGORIES);
    expect(unique.size).toBe(TENDER_CATEGORIES.length);
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
pnpm --filter @mn-platform/platform test
```

Expected: FAIL — `Cannot find module './tender-categories'`

- [ ] **Step 2.3: Create the constant**

Create `apps/platform/src/lib/tender-categories.ts`:

```ts
export const TENDER_CATEGORIES = [
  "Барилга угсралт",
  "Бараа нийлүүлэлт",
  "Үйлчилгээ",
  "Зөвлөх үйлчилгээ",
  "Технологи, МТ",
  "Тоног төхөөрөмж",
  "Хүнс, ундаа",
  "Эм, эмнэлгийн хэрэгсэл",
  "Судалгаа, шинжилгээ",
  "Сургалт",
] as const;

export type TenderCategory = (typeof TENDER_CATEGORIES)[number];
```

- [ ] **Step 2.4: Run test to confirm it passes**

```bash
pnpm --filter @mn-platform/platform test
```

Expected: PASS (2 tests)

- [ ] **Step 2.5: Commit**

```bash
git add apps/platform/src/lib/tender-categories.ts apps/platform/src/lib/tender-categories.test.ts
git commit -m "feat(platform): TENDER_CATEGORIES constant"
```

---

## Task 3: Chat ID validator + test

**Files:**
- Create: `apps/platform/src/lib/parse-chat-id.ts`
- Create: `apps/platform/src/lib/parse-chat-id.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `apps/platform/src/lib/parse-chat-id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseChatId } from "./parse-chat-id";

describe("parseChatId", () => {
  it("accepts a positive user chat ID", () => {
    expect(parseChatId("123456789")).toEqual({ ok: true, value: "123456789" });
  });

  it("accepts a negative group chat ID", () => {
    expect(parseChatId("-1001234567890")).toEqual({ ok: true, value: "-1001234567890" });
  });

  it("trims whitespace", () => {
    expect(parseChatId("  99  ")).toEqual({ ok: true, value: "99" });
  });

  it("rejects empty string", () => {
    const r = parseChatId("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it("rejects floats", () => {
    const r = parseChatId("123.4");
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const r = parseChatId("abc");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
pnpm --filter @mn-platform/platform test
```

Expected: FAIL — `Cannot find module './parse-chat-id'`

- [ ] **Step 3.3: Create the validator**

Create `apps/platform/src/lib/parse-chat-id.ts`:

```ts
export function parseChatId(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Chat ID is required" };
  if (trimmed.includes(".")) return { ok: false, error: "Chat ID must be a whole number" };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    return { ok: false, error: "Chat ID must be a whole number" };
  }
  return { ok: true, value: trimmed };
}
```

- [ ] **Step 3.4: Run test to confirm it passes**

```bash
pnpm --filter @mn-platform/platform test
```

Expected: PASS (all 6 tests)

- [ ] **Step 3.5: Commit**

```bash
git add apps/platform/src/lib/parse-chat-id.ts apps/platform/src/lib/parse-chat-id.test.ts
git commit -m "feat(platform): parseChatId validator"
```

---

## Task 4: Create subscription row on first user creation

**Files:**
- Modify: `apps/platform/src/auth.ts`

- [ ] **Step 4.1: Add subscriptions import**

In `apps/platform/src/auth.ts`, change:

```ts
import { db, eq, organizations, users } from "@mn-platform/db";
```

to:

```ts
import { db, eq, organizations, subscriptions, users } from "@mn-platform/db";
```

- [ ] **Step 4.2: Insert subscription after first user insert**

In the `authorize` callback, find the block that creates a new org + user. It currently ends with:

```ts
const [user] = await db
  .insert(users)
  .values({
    telegramId: tgUser.id,
    orgId: org.id,
    name: tgUser.first_name,
    telegramUsername: tgUser.username ?? null,
    lastLoginAt: new Date(),
  })
  .returning();
if (!user) throw new Error("Failed to create user");

return {
  id: user.id,
  telegramId: user.telegramId!,
  name: user.name,
  email: user.email,
  orgId: user.orgId,
};
```

Insert the subscription between the user insert guard and the return:

```ts
const [user] = await db
  .insert(users)
  .values({
    telegramId: tgUser.id,
    orgId: org.id,
    name: tgUser.first_name,
    telegramUsername: tgUser.username ?? null,
    lastLoginAt: new Date(),
  })
  .returning();
if (!user) throw new Error("Failed to create user");

await db.insert(subscriptions).values({
  orgId: org.id,
  modules: [],
  categories: [],
  alertChannels: [],
  status: "trial",
});

return {
  id: user.id,
  telegramId: user.telegramId!,
  name: user.name,
  email: user.email,
  orgId: user.orgId,
};
```

- [ ] **Step 4.3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4.4: Commit**

```bash
git add apps/platform/src/auth.ts
git commit -m "feat(platform): create trial subscription on first user login"
```

---

## Task 5: Extend server actions

**Files:**
- Modify: `apps/platform/src/app/onboarding/actions.ts`

Replace the entire file with the following. All four actions use the same `ActionState` return type. The key change to the existing `saveEmail` is the final `redirect` destination — `/onboarding?step=1` instead of `/dashboard`.

- [ ] **Step 5.1: Replace actions.ts**

```ts
"use server";

import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { db, users, subscriptions, eq } from "@mn-platform/db";
import { parseChatId } from "@/lib/parse-chat-id";

type ActionState = { error: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveEmail(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.get("email");
  const email = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { error: "Please enter a valid email address" };
  }

  const conflict = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (conflict && conflict.id !== session.user.id) {
    return { error: "That email is already in use" };
  }

  try {
    await db.update(users).set({ email }).where(eq(users.id, session.user.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("23505") || msg.includes("users_email_idx")) {
      return { error: "That email is already in use" };
    }
    throw err;
  }

  await unstable_update({ user: { email } });
  redirect("/onboarding?step=1");
}

export async function saveModules(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.getAll("modules").filter((m): m is string => typeof m === "string");
  const valid = raw.every((m) => m === "tender" || m === "gazar");
  if (!valid) return { error: "Invalid module selection" };

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: raw,
      categories: [],
      alertChannels: [],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { modules: raw, updatedAt: new Date() },
    });

  return null;
}

export async function saveCategories(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const categories = formData
    .getAll("categories")
    .filter((c): c is string => typeof c === "string");

  await db
    .insert(subscriptions)
    .values({
      orgId: session.user.orgId,
      modules: [],
      categories,
      alertChannels: [],
      status: "trial",
    })
    .onConflictDoUpdate({
      target: subscriptions.orgId,
      set: { categories, updatedAt: new Date() },
    });

  return null;
}

export async function saveTelegramChatId(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const raw = formData.get("chatId");
  const result = parseChatId(typeof raw === "string" ? raw : "");
  if (!result.ok) return { error: result.error };

  await db
    .update(users)
    .set({ telegramChatId: result.value })
    .where(eq(users.id, session.user.id));

  return null;
}
```

- [ ] **Step 5.2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add apps/platform/src/app/onboarding/actions.ts
git commit -m "feat(platform): onboarding server actions (modules, categories, telegram)"
```

---

## Task 6: Wizard client component

**Files:**
- Create: `apps/platform/src/app/onboarding/wizard.tsx`

- [ ] **Step 6.1: Create wizard.tsx**

Create `apps/platform/src/app/onboarding/wizard.tsx`:

```tsx
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
```

- [ ] **Step 6.2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add apps/platform/src/app/onboarding/wizard.tsx
git commit -m "feat(platform): OnboardingWizard client component"
```

---

## Task 7: Replace page.tsx with server component

**Files:**
- Modify: `apps/platform/src/app/onboarding/page.tsx`

- [ ] **Step 7.1: Replace page.tsx**

Replace the entire contents of `apps/platform/src/app/onboarding/page.tsx` with:

```tsx
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
  const requestedStep = Number(params.step ?? 0);

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

  // Skip categories step if tender is not selected
  if (effectiveStep === 2 && !modules.includes("tender")) {
    redirect("/onboarding?step=3");
  }

  return (
    <OnboardingWizard
      initialStep={effectiveStep}
      existingModules={modules}
      existingCategories={subscription?.categories ?? []}
      existingTelegramChatId={user?.telegramChatId ?? null}
      botUsername={process.env["TELEGRAM_BOT_USERNAME"] ?? null}
    />
  );
}
```

- [ ] **Step 7.2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7.3: Run full lint + tests**

```bash
pnpm lint && pnpm test
```

Expected: lint clean, all tests pass.

- [ ] **Step 7.4: Commit**

```bash
git add apps/platform/src/app/onboarding/page.tsx
git commit -m "feat(platform): onboarding wizard — 5-step setup flow"
```

---

## Task 8: Manual smoke test

These cannot be automated — verify by running the dev server.

- [ ] **Step 8.1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 8.2: New user flow (no email)**

1. Log in via Telegram as a user with no email in the DB (or clear `users.email` to null for your test account).
2. Confirm redirect to `/onboarding?step=0` (email form).
3. Enter email → submit → confirm redirect to `/onboarding?step=1`.
4. Select a module → "Save & Continue" → confirm advance to `?step=2` (if Tender) or `?step=3` (if Гazar-only).
5. If at step 2, select/skip categories → confirm advance to `?step=3`.
6. At step 3, enter or skip chat ID → confirm advance to `?step=4`.
7. Step 4 Done screen → "Go to Dashboard" → confirm `/dashboard` loads.

- [ ] **Step 8.3: Re-entry flow (email already set)**

1. Navigate directly to `/onboarding`.
2. Confirm auto-redirect to `?step=1` (email step skipped).
3. Confirm existing module/category selections are pre-filled.

- [ ] **Step 8.4: Skip buttons**

1. At step 1, click Skip → confirm advance to step 2 (or 3 if Gazar-only).
2. At step 3, click Skip → confirm advance to step 4.

- [ ] **Step 8.5: Dashboard still works**

Navigate to `/dashboard` — confirm page loads and no redirect loop occurs.

---

## Definition of Done

- [ ] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (8 tests across 2 files)
- [ ] Migration 0005 applied to dev DB
- [ ] Manual smoke test: new user completes full wizard and lands on `/dashboard`
- [ ] Manual smoke test: existing user re-enters at `?step=1` with pre-filled data
- [ ] No raw SQL string interpolation introduced
- [ ] No secrets in code
