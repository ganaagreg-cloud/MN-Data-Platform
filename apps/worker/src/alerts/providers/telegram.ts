import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class TelegramProvider implements ChannelProvider {
  readonly channel = "telegram" as const;

  async send(_notification: Notification, _recipient: Recipient): Promise<void> {
    throw new Error("TelegramProvider: not yet implemented");
  }
}
