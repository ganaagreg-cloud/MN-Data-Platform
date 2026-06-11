import PgBoss from "pg-boss";
import { Resend } from "resend";
import { z } from "zod";
import { dispatchAlert } from "../alerts/dispatch.js";
import { ResendEmailProvider } from "../alerts/providers/email.js";
import { logger } from "../logger.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

const AlertJobPayloadSchema = z.object({
  recordId:    z.string().uuid(),
  contentHash: z.string().min(1),
  userId:      z.string().uuid(),
});

// Singleton — constructed once at worker startup.
function createEmailProvider(): ResendEmailProvider {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from   = requireEnv("RESEND_FROM");
  return new ResendEmailProvider(new Resend(apiKey), from);
}

export const emailProvider = createEmailProvider();

export function makeAlertDispatchHandler() {
  return async function handler(jobs: PgBoss.Job<unknown>[]) {
    const job = jobs[0];
    if (!job) return;
    // Zod throws on invalid payload → pg-boss marks job failed, no retry
    const payload = AlertJobPayloadSchema.parse(job.data);
    await dispatchAlert(payload, [emailProvider]);
    // TODO: add telegramProvider, smsProvider when implemented
    logger.info({ recordId: payload.recordId, userId: payload.userId }, "alert dispatched");
  };
}
