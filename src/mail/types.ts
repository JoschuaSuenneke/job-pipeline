// Port for mail providers. Read-only by default; moving and drafting are separate, opt-in capabilities.
export interface MailMessage {
  id: string;
  receivedAt: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  /** True for messages the user sent (Sent folder, own address). They are never treated as replies. */
  fromSelf: boolean;
}

export interface Draft {
  to: string;
  subject: string;
  body: string;
  attachments: { filename: string; path: string }[];
}

export interface MailProvider {
  id: "imap" | "gmail" | "microsoft";
  /** Messages received after `since` (ISO date), newest last. */
  listMessages(since: string): Promise<MailMessage[]>;
  /** Optional: file a message into a folder/label. Only called when config.mail.fileConfirmations is true. */
  moveToFolder?(messageId: string, folder: string): Promise<void>;
  /** Optional: create a draft in the user's mailbox. Never sends. */
  createDraft?(draft: Draft): Promise<{ id: string }>;
  close(): Promise<void>;
}

export type MailKind = "confirmation" | "rejection" | "interview" | "offer" | "action" | "reply" | "other";
