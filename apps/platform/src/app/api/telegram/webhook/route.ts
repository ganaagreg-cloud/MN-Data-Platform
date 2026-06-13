// apps/platform/src/app/api/telegram/webhook/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, authTokens } from "@mn-platform/db";
import { sendTelegramMessageTo } from "@mn-platform/core";

const TelegramUpdateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
      from: z.object({
        id: z.number(),
        username: z.string().optional(),
        first_name: z.string().optional(),
      }),
    })
    .optional(),
});

const AUTH_START_RE = /^\/start auth_([a-f0-9]{32})$/;

interface TelegramFrom {
  id: number;
  username?: string | undefined;
  first_name?: string | undefined;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const update = TelegramUpdateSchema.parse(await req.json());
    const message = update.message;
    const text = message?.text;

    if (message && text) {
      const match = AUTH_START_RE.exec(text);
      if (match) {
        await handleAuthStart(match[1]!, message.from, message.chat.id);
      } else if (text.startsWith("/start")) {
        await sendTelegramMessageTo(
          message.chat.id,
          "Тавтай морил! Нэвтрэхийн тулд вэб хуудас руу буцаж, холбоос дээр дарна уу.",
        );
      }
    }
  } catch (err) {
    console.error("telegram webhook error", err);
  }

  // Always 200 — non-2xx makes Telegram retry the same update.
  return NextResponse.json({ ok: true });
}

async function handleAuthStart(token: string, from: TelegramFrom, chatId: number): Promise<void> {
  const tokenRow = await db.query.authTokens.findFirst({ where: eq(authTokens.token, token) });

  if (!tokenRow || tokenRow.consumed || tokenRow.expiresAt < new Date()) {
    await sendTelegramMessageTo(chatId, "Холбоосын хугацаа дууссан. Вэб хуудсыг шинэчлээд дахин оролдоно уу.");
    return;
  }

  const existing = await db.query.users.findFirst({ where: eq(users.telegramId, from.id) });
  const fields = {
    telegramUsername: from.username ?? null,
    firstName: from.first_name ?? null,
    lastLoginAt: new Date(),
  };

  if (existing) {
    await db.update(users).set(fields).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ telegramId: from.id, ...fields });
  }

  await db.update(authTokens).set({ telegramId: from.id, consumed: true }).where(eq(authTokens.token, token));
  await sendTelegramMessageTo(chatId, "Амжилттай нэвтэрлээ! Вэб рүү буцна уу.");
}
