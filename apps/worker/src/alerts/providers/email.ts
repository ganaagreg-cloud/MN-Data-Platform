import { Resend } from "resend";
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class ResendEmailProvider implements ChannelProvider {
  readonly channel = "email" as const;
  private readonly resend: Resend;
  private readonly from: string;

  constructor(resend: Resend, from: string) {
    this.resend = resend;
    this.from = from;
  }

  async send(notification: Notification, recipient: Recipient): Promise<void> {
    if (!recipient.email) throw new Error("Email recipient has no email address");
    const html = `
      <table style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <tr><td><h2 style="color:#1a1a1a">${escapeHtml(notification.subject)}</h2></td></tr>
        <tr><td><pre style="white-space:pre-wrap;font-family:sans-serif;color:#333">
${escapeHtml(notification.body)}</pre></td></tr>
      </table>
    `;

    const { error } = await this.resend.emails.send({
      from:    this.from,
      to:      recipient.email,
      subject: notification.subject,
      html,
      text:    notification.body,
    });

    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
