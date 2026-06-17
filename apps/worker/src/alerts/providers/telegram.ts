import { sendTelegramMessageTo } from "@mn-platform/core";
import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class TelegramProvider implements ChannelProvider {
  readonly channel = "telegram" as const;

  async send(notification: Notification, recipient: Recipient): Promise<void> {
    if (!recipient.telegramChatId) {
      return;
    }
    await sendTelegramMessageTo(recipient.telegramChatId, notification.body);
  }
}
