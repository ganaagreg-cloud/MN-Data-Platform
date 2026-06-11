export type AlertChannel = "email" | "telegram" | "sms";

export interface Notification {
  recordId: string;
  contentHash: string;
  subject: string;
  /** Plain text. Each provider renders its own HTML wrapper if needed. */
  body: string;
}

export interface Recipient {
  userId: string;
  email: string;
  telegramChatId?: string;
  phone?: string;
}

export interface ChannelProvider {
  channel: AlertChannel;
  send(notification: Notification, recipient: Recipient): Promise<void>;
}

export interface AlertJobPayload {
  recordId: string;
  contentHash: string;
  userId: string;
}
