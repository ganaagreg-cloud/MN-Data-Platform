import type { ChannelProvider, Notification, Recipient } from "../types.js";

export class SmsProvider implements ChannelProvider {
  readonly channel = "sms" as const;

  async send(_notification: Notification, _recipient: Recipient): Promise<void> {
    throw new Error("SmsProvider: not yet implemented");
  }
}
